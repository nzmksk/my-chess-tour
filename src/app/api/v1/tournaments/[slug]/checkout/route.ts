import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { EntryFees } from "@/app/tournaments/types";
import {
  checkRestrictions,
  checkFeeTierEligibility,
  checkRatedRequirements,
  normalizeRestrictions,
} from "@/app/api/v1/tournaments/[slug]/registrations/validators";
import type { RegistrationRequest } from "@/app/tournaments/[slug]/register/types";
import { registrationStatus } from "@/lib/registration-status";
import {
  cancelChipPurchase,
  createChipPurchase,
  PAYMENT_TIMEOUT_MINUTES,
} from "@/services/chip/chip";

// The seat hold (and the CHIP purchase `due`) lasts PAYMENT_TIMEOUT_MINUTES from
// registered_at. While live, the pending payment is resumed by reusing its link.
function isHoldLive(registeredAt: string): boolean {
  return (
    Date.now() - new Date(registeredAt).getTime() <
    PAYMENT_TIMEOUT_MINUTES * 60_000
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;

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
      "id, name, entry_fees, max_participants, registration_deadline, registration_closed_at, start_date, restrictions, format, is_fide_rated, is_mcf_rated",
    )
    .eq("slug", slug)
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

  // Internal DB writes/reads key off the resolved UUID; the slug is only used to
  // build the public success/failure redirect URLs (passed to the helpers below).
  const tournamentId = tournament.id;

  const now = new Date();
  // Age eligibility is anchored to the tournament start date (see
  // checkAgeEligibility), not "now" — a player who ages out between registration
  // and the event, or registers in a different calendar year, is judged by the
  // event date, not their registration-day age.
  const startDate = new Date(tournament.start_date);

  // registration_closed_at is the effective close time (deadline by default,
  // earlier if the organizer closed registration early).
  const { isClosed, closedEarly } = registrationStatus(
    tournament.registration_closed_at,
    tournament.registration_deadline,
    now,
  );
  if (isClosed) {
    return NextResponse.json(
      {
        error: {
          code: "REGISTRATION_CLOSED",
          message: closedEarly
            ? "Registration has been closed by the organizer"
            : "Registration deadline has passed",
        },
      },
      { status: 422 },
    );
  }

  // Capacity is enforced authoritatively in Postgres: the create path via the
  // check_tournament_capacity trigger, the resume path via
  // start_new_payment_attempt. Both apply the reservation hold window, so there
  // is no JS pre-check here (it would double-count lapsed holds).

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
    restrictions?.gender != null ||
    restrictions?.nationality != null
  );

  const needsRatedProfile =
    tournament.is_fide_rated === true || tournament.is_mcf_rated === true;

  if (needsTierProfile || needsRestrictionProfile || needsRatedProfile) {
    const { data: profile } = await supabaseAdmin
      .from("player_profiles")
      .select(
        "date_of_birth, gender, oku_status, title, fide_rating, national_rating, fide_id, mcf_id, nationality",
      )
      .eq("user_id", user.id)
      .single();

    if (needsRestrictionProfile && restrictions) {
      const restrictionError = checkRestrictions(
        restrictions,
        profile,
        (tournament.format as { type: string }).type,
        startDate,
      );
      if (restrictionError) return restrictionError;
    }

    const tierError = checkFeeTierEligibility(matchedTier, profile, startDate);
    if (tierError) return tierError;

    const ratedError = checkRatedRequirements(
      {
        is_fide_rated: tournament.is_fide_rated === true,
        is_mcf_rated: tournament.is_mcf_rated === true,
      },
      profile,
    );
    if (ratedError) return ratedError;
  }

  const { data: existing } = await supabaseAdmin
    .from("registrations")
    .select("id, status, fee_tier, registered_at, current_payment_id")
    .eq("user_id", user.id)
    .eq("tournament_id", tournamentId)
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

    // A still-live pending payment is resumed by reusing its existing CHIP link —
    // no timer reset, and the fee tier is locked until the hold lapses.
    if (
      existing.status === "pending_payment" &&
      isHoldLive(existing.registered_at)
    ) {
      return continuePendingPayment(
        existing.id,
        existing.fee_tier,
        fee_tier,
        existing.registered_at,
        existing.current_payment_id,
        matchedTier.amount_cents,
        slug,
        tournament.name,
        user.email!,
      );
    }

    // Lapsed pending, a declined payment, or an expired (cancelled) checkout:
    // start fresh (new link + timer), with a possibly different tier.
    if (
      existing.status === "pending_payment" ||
      existing.status === "failed_payment" ||
      existing.status === "cancelled_payment"
    ) {
      return resumeRegistration(
        existing.id,
        existing.current_payment_id,
        fee_tier,
        matchedTier.amount_cents,
        slug,
        tournament.name,
        user.email!,
      );
    }

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

  const { data: registration, error: insertErr } = await supabaseAdmin.rpc(
    "create_registration_with_payment",
    {
      p_user_id: user.id,
      p_tournament_id: tournamentId,
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
    // Lost a concurrent create race (e.g. a double-submit): the UNIQUE
    // (user_id, tournament_id) constraint rejected our insert. Re-read the row
    // the winner created and resume it rather than surfacing a 500.
    if (insertErr.code === "23505") {
      const { data: raced } = await supabaseAdmin
        .from("registrations")
        .select("id, status, current_payment_id")
        .eq("user_id", user.id)
        .eq("tournament_id", tournamentId)
        .maybeSingle();
      if (
        raced &&
        (raced.status === "pending_payment" ||
          raced.status === "failed_payment" ||
          raced.status === "cancelled_payment")
      ) {
        return resumeRegistration(
          raced.id,
          raced.current_payment_id,
          fee_tier,
          matchedTier.amount_cents,
          slug,
          tournament.name,
          user.email!,
        );
      }
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
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: insertErr.message } },
      { status: 500 },
    );
  }

  return initiateChipPayment(
    (registration as { payment_id: string }).payment_id,
    slug,
    tournament.name,
    user.email!,
  );
}

/**
 * Continues a still-live pending payment by handing back the *same* CHIP
 * checkout link — no timer reset, no new purchase. The fee tier is locked: a
 * request for a different tier is rejected until the hold lapses (after which
 * the registration expires and can be re-registered with any tier). Falls back
 * to a fresh start only if no checkout link was ever stored.
 */
async function continuePendingPayment(
  registrationId: string,
  currentFeeTier: string,
  requestedFeeTier: string,
  registeredAt: string,
  currentPaymentId: string | null,
  amountCents: number,
  tournamentSlug: string,
  tournamentName: string,
  userEmail: string,
): Promise<NextResponse> {
  // Look up the current attempt's stored link first. Whether a payment is truly
  // "in progress" (and thus tier-locked) hinges on a live link existing.
  const { data: payment } = currentPaymentId
    ? await supabaseAdmin
        .from("payments")
        .select("checkout_url")
        .eq("id", currentPaymentId)
        .maybeSingle()
    : { data: null };

  // No stored link (an earlier purchase-create failed) — nothing is actually in
  // progress to protect, so start a fresh attempt for whatever tier was requested
  // rather than leaving the user stuck or locking them out of a different tier.
  if (!payment?.checkout_url) {
    return resumeRegistration(
      registrationId,
      currentPaymentId,
      requestedFeeTier,
      amountCents,
      tournamentSlug,
      tournamentName,
      userEmail,
    );
  }

  // A live link exists: the tier is locked until the hold lapses. A request for a
  // different tier is rejected with the time it unlocks.
  if (requestedFeeTier !== currentFeeTier) {
    const unlockAt = new Date(
      new Date(registeredAt).getTime() + PAYMENT_TIMEOUT_MINUTES * 60_000,
    ).toISOString();
    return NextResponse.json(
      {
        error: {
          code: "PAYMENT_IN_PROGRESS",
          message:
            `You have a payment in progress for the '${currentFeeTier}' fee. ` +
            `Complete it, or wait until ${unlockAt} to choose a different tier.`,
          unlock_at: unlockAt,
        },
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      data: {
        checkout_url: payment.checkout_url,
        registration_id: registrationId,
      },
    },
    { status: 201 },
  );
}

/**
 * Starts a fresh payment attempt for a lapsed/failed/expired registration:
 * cancels the prior attempt's still-payable CHIP purchase (double-charge guard),
 * appends a new pending payment row for the chosen tier, and issues a new
 * purchase. The old payment row is preserved (immutable ledger).
 */
async function resumeRegistration(
  registrationId: string,
  currentPaymentId: string | null,
  feeTier: string,
  amountCents: number,
  tournamentSlug: string,
  tournamentName: string,
  userEmail: string,
): Promise<NextResponse> {
  // Cancel the prior attempt's purchase so its abandoned link can't be paid after
  // we issue a new one. The new attempt's row supersedes it regardless, so its
  // late webhook is harmless — this is purely a double-charge guard. Best-effort.
  if (currentPaymentId) {
    const { data: prior } = await supabaseAdmin
      .from("payments")
      .select("chip_transaction_id")
      .eq("id", currentPaymentId)
      .maybeSingle();

    if (prior?.chip_transaction_id) {
      try {
        await cancelChipPurchase(prior.chip_transaction_id);
      } catch (err) {
        // CHIP may already have cancelled/expired it. Log and go on.
        console.warn("CHIP purchase cancel failed (continuing):", err);
      }
    }
  }

  const { data: attempt, error: attemptErr } = await supabaseAdmin.rpc(
    "start_new_payment_attempt",
    {
      p_registration_id: registrationId,
      p_fee_tier: feeTier,
      p_amount_cents: amountCents,
    },
  );

  if (attemptErr) {
    if (attemptErr.message?.toLowerCase().includes("full")) {
      return NextResponse.json(
        { error: { code: "CAPACITY_FULL", message: "Tournament is full" } },
        { status: 422 },
      );
    }
    if (attemptErr.code === "P0001") {
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
      { error: { code: "INTERNAL_ERROR", message: attemptErr.message } },
      { status: 500 },
    );
  }

  return initiateChipPayment(
    (attempt as { payment_id: string }).payment_id,
    tournamentSlug,
    tournamentName,
    userEmail,
  );
}

/**
 * Completes a free (zero-gross) registration without touching the payment
 * gateway. Settles the pending payment as paid through the same idempotent RPC
 * the CHIP webhook uses — flipping the registration to confirmed — and sends the
 * user to the success page, where the confirmed registration is shown. If the
 * settle fails, the registration is left pending and auto-expires, so the user
 * can simply retry.
 */
async function settleFreeRegistration(
  paymentId: string,
  registrationId: string,
  tournamentSlug: string,
): Promise<NextResponse> {
  const { error: settleErr } = await supabaseAdmin.rpc(
    "settle_registration_payment",
    {
      p_payment_id: paymentId,
      p_paid: true,
      p_amount_cents: 0,
      // No gateway/instrument for a zero-gross registration; record a sentinel
      // so the column is never null and free registrations stay distinguishable.
      p_payment_method: "free",
    },
  );

  if (settleErr) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: settleErr.message } },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      data: {
        registration_id: registrationId,
        redirect_url: `/tournaments/${tournamentSlug}/register/success`,
      },
    },
    { status: 201 },
  );
}

async function initiateChipPayment(
  paymentId: string,
  tournamentSlug: string,
  tournamentName: string,
  userEmail: string,
): Promise<NextResponse> {
  const { data: payment, error: payErr } = await supabaseAdmin
    .from("payments")
    .select("id, registration_id, gross_amount_cents")
    .eq("id", paymentId)
    .single();

  if (payErr || !payment) {
    return NextResponse.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Payment record not found" },
      },
      { status: 500 },
    );
  }

  // A zero-gross tier (e.g. a RM0.00 fee for titled players) has nothing to
  // charge, so bypass the payment gateway entirely: settle the attempt as paid
  // and confirm the registration immediately. Every payment path funnels through
  // here (create, resume, race-recovery), so this is the one place to branch.
  if (payment.gross_amount_cents === 0) {
    return settleFreeRegistration(
      payment.id,
      payment.registration_id,
      tournamentSlug,
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
      successRedirect: `${siteUrl}/tournaments/${tournamentSlug}/register/success`,
      failureRedirect: `${siteUrl}/tournaments/${tournamentSlug}/register/failure`,
      // Payment status is delivered server-side by the CHIP account webhook
      // (subscribed to purchase.paid / payment_failure / cancelled) → /api/v1/webhooks/chip.
      // No success_callback: it's signed with a different key than the webhook
      // and would be redundant with the subscribed purchase.paid event.
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

  const { error: updErr } = await supabaseAdmin
    .from("payments")
    .update({
      chip_transaction_id: chipPurchase.id,
      checkout_url: chipPurchase.checkout_url,
    })
    .eq("id", payment.id);

  if (updErr) {
    // The purchase exists at CHIP but we failed to record its id. The webhook
    // can still settle via `reference` (= payment.id), so don't fail the user;
    // log loudly for investigation.
    console.error(
      "Failed to persist chip_transaction_id for payment",
      payment.id,
      updErr,
    );
  }

  return NextResponse.json(
    {
      data: {
        checkout_url: chipPurchase.checkout_url,
        registration_id: payment.registration_id,
      },
    },
    { status: 201 },
  );
}
