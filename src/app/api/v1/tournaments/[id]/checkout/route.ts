import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { EntryFees } from "@/app/tournaments/types";
import {
  checkRestrictions,
  checkFeeTierEligibility,
  normalizeRestrictions,
} from "@/app/api/v1/tournaments/[id]/registrations/validators";
import type { RegistrationRequest } from "@/app/tournaments/[id]/register/types";
import { createChipPurchase } from "@/services/chip/chip";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid tournament ID" } },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  let body: RegistrationRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  const { fee_tier } = body;
  if (!fee_tier || typeof fee_tier !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "fee_tier is required" } },
      { status: 400 },
    );
  }

  const { data: tournament, error: tErr } = await supabaseAdmin
    .from("tournaments")
    .select(
      "id, name, entry_fees, max_participants, registration_deadline, restrictions, format",
    )
    .eq("id", id)
    .eq("status", "published")
    .single();

  if (tErr) {
    if (tErr.code === "PGRST116") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Tournament not found" } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: tErr.message } },
      { status: 500 },
    );
  }

  const now = new Date();

  if (new Date(tournament.registration_deadline) < now) {
    return NextResponse.json(
      {
        error: {
          code: "REGISTRATION_CLOSED",
          message: "Registration deadline has passed",
        },
      },
      { status: 422 },
    );
  }

  // Capacity is enforced authoritatively in Postgres: the create path via the
  // check_tournament_capacity trigger, the resume path via
  // reset_registration_for_payment. Both apply the reservation hold window, so
  // there is no JS pre-check here (it would double-count lapsed holds).

  const fees = tournament.entry_fees as EntryFees;

  type AdditionalTier = NonNullable<EntryFees["additional"]>[number];
  type StandardTier = {
    type: "standard";
    amount_cents: number;
    valid_until?: undefined;
    age_min?: undefined;
    age_max?: undefined;
    gender?: undefined;
    oku?: undefined;
    titles?: undefined;
  };
  type Tier = StandardTier | AdditionalTier;

  const standardTier: StandardTier = {
    type: "standard",
    amount_cents: fees.standard.amount_cents,
  };

  let matchedTier: Tier | null = null;
  if (fee_tier === "standard") {
    matchedTier = standardTier;
  } else {
    matchedTier =
      (fees.additional ?? []).find((t) => t.type === fee_tier) ?? null;
  }

  if (!matchedTier) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_FEE_TIER",
          message: `Invalid fee tier: ${fee_tier}`,
        },
      },
      { status: 400 },
    );
  }

  if (matchedTier.valid_until && new Date(matchedTier.valid_until) < now) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_FEE_TIER",
          message: "This fee tier has expired",
        },
      },
      { status: 400 },
    );
  }

  const restrictions = normalizeRestrictions(tournament.restrictions);

  const needsTierProfile =
    matchedTier.age_min != null ||
    matchedTier.age_max != null ||
    matchedTier.gender != null ||
    matchedTier.oku === true ||
    (matchedTier.titles?.length ?? 0) > 0;

  const needsRestrictionProfile = !!(
    (restrictions?.titles?.length ?? 0) > 0 ||
    restrictions?.min_rating != null ||
    restrictions?.max_rating != null ||
    restrictions?.min_age != null ||
    restrictions?.max_age != null ||
    restrictions?.gender != null
  );

  if (needsTierProfile || needsRestrictionProfile) {
    const { data: profile } = await supabaseAdmin
      .from("player_profiles")
      .select(
        "date_of_birth, gender, is_oku, title, fide_rating, national_rating",
      )
      .eq("user_id", user.id)
      .single();

    if (needsRestrictionProfile && restrictions) {
      const restrictionError = checkRestrictions(
        restrictions,
        profile,
        (tournament.format as { type: string }).type,
        now,
      );
      if (restrictionError) return restrictionError;
    }

    const tierError = checkFeeTierEligibility(matchedTier, profile, now);
    if (tierError) return tierError;
  }

  const { data: existing } = await supabaseAdmin
    .from("registrations")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("tournament_id", id)
    .maybeSingle();

  if (existing) {
    if (existing.status === "confirmed") {
      return NextResponse.json(
        {
          error: {
            code: "ALREADY_REGISTERED",
            message: "You are already registered for this tournament",
          },
        },
        { status: 409 },
      );
    }

    if (
      existing.status !== "pending_payment" &&
      existing.status !== "failed_payment"
    ) {
      return NextResponse.json(
        {
          error: {
            code: "ALREADY_REGISTERED",
            message: `Cannot re-register: existing registration has status '${existing.status}'`,
          },
        },
        { status: 409 },
      );
    }

    // Resume an existing pending/failed registration. Re-price it for the
    // (possibly different) chosen tier and reset its payment to pending so a
    // fresh CHIP purchase can be created.
    const { error: resetErr } = await supabaseAdmin.rpc(
      "reset_registration_for_payment",
      {
        p_registration_id: existing.id,
        p_fee_tier: fee_tier,
        p_amount_cents: matchedTier.amount_cents,
      },
    );

    if (resetErr) {
      if (resetErr.message?.toLowerCase().includes("full")) {
        return NextResponse.json(
          { error: { code: "CAPACITY_FULL", message: "Tournament is full" } },
          { status: 422 },
        );
      }
      if (resetErr.code === "P0001") {
        return NextResponse.json(
          {
            error: {
              code: "ALREADY_REGISTERED",
              message: "This registration can no longer be paid for",
            },
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: resetErr.message } },
        { status: 500 },
      );
    }

    return initiateChipPayment(existing.id, id, tournament.name, user.email!);
  }

  const { data: registration, error: insertErr } = await supabaseAdmin.rpc(
    "create_registration_with_payment",
    {
      p_user_id: user.id,
      p_tournament_id: id,
      p_fee_tier: fee_tier,
      p_amount_cents: matchedTier.amount_cents,
    },
  );

  if (insertErr) {
    if (
      insertErr.message.includes("Tournament is full") ||
      insertErr.code === "P0001"
    ) {
      return NextResponse.json(
        { error: { code: "CAPACITY_FULL", message: "Tournament is full" } },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: insertErr.message } },
      { status: 500 },
    );
  }

  return initiateChipPayment(
    (registration as { id: string }).id,
    id,
    tournament.name,
    user.email!,
  );
}

async function initiateChipPayment(
  registrationId: string,
  tournamentId: string,
  tournamentName: string,
  userEmail: string,
): Promise<NextResponse> {
  const { data: payment, error: payErr } = await supabaseAdmin
    .from("payments")
    .select("id, gross_amount_cents")
    .eq("registration_id", registrationId)
    .eq("status", "pending")
    .single();

  if (payErr || !payment) {
    return NextResponse.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Payment record not found" },
      },
      { status: 500 },
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  let chipPurchase: { id: string; checkout_url: string };
  try {
    chipPurchase = await createChipPurchase({
      amountCents: payment.gross_amount_cents,
      clientEmail: userEmail,
      productName: `Tournament Registration — ${tournamentName}`,
      referenceId: payment.id,
      successRedirect: `${siteUrl}/tournaments/${tournamentId}/register/success`,
      failureRedirect: `${siteUrl}/tournaments/${tournamentId}/register/failure`,
      successCallback: `${siteUrl}/api/v1/webhooks/chip`,
    });
  } catch (err) {
    console.error("CHIP purchase creation failed:", err);
    return NextResponse.json(
      {
        error: {
          code: "PAYMENT_GATEWAY_ERROR",
          message: "Unable to initiate payment. Please try again.",
        },
      },
      { status: 503 },
    );
  }

  await supabaseAdmin
    .from("payments")
    .update({ chip_transaction_id: chipPurchase.id })
    .eq("id", payment.id);

  return NextResponse.json(
    {
      data: {
        checkout_url: chipPurchase.checkout_url,
        registration_id: registrationId,
      },
    },
    { status: 201 },
  );
}
