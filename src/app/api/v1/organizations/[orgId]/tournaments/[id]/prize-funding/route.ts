import { supabaseAdmin } from "@/services/supabase/admin";
import {
  authorizeOrgPermission,
  UUID_RE,
} from "@/app/api/v1/organizations/_lib/authorize-org";
import { createChipPurchase } from "@/services/chip/chip";
import type { PurchasesResponse } from "@/services/chip/interfaces/purchases-response";
import { loadPrizePoolPosition, unfundedCents } from "@/services/prizes/pool";
import { formatRinggit } from "@/services/payouts/format";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

// The platform-managed prize pool, money in (#523). Only for a tournament whose
// prizes.distribution is "platform". The organizer creates a CHIP Collect
// checkout link here and forwards it to their sponsor; the sponsor pays it, and
// the Collect webhook settles the contribution (settle_prize_funding).
//
// Entry fees never fund prizes, so this is the only way money enters the pool.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

interface FundingTournament {
  id: string;
  name: string;
  status: "draft" | "published" | "cancelled";
  prizes: { distribution?: string } | null;
}

async function loadTournament(
  orgId: string,
  id: string,
): Promise<{ tournament: FundingTournament } | { response: NextResponse }> {
  if (!UUID_RE.test(id)) {
    return { response: errorResponse("VALIDATION_ERROR", "Invalid tournament ID", 400) };
  }
  const { data, error } = await supabaseAdmin
    .from("tournaments")
    .select("id, name, status, prizes")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) {
    return {
      response: internalErrorResponse(
        `Prize funding: failed to load tournament ${id}`,
        error,
      ),
    };
  }
  if (!data) {
    return { response: errorResponse("NOT_FOUND", "Tournament not found", 404) };
  }
  return { tournament: data as FundingTournament };
}

/**
 * The pool's position and every contribution asked for so far, newest first.
 * Readable by anyone who can see the organization's payouts.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.view");
  if (!auth.ok) return auth.response;

  const loaded = await loadTournament(orgId, id);
  if ("response" in loaded) return loaded.response;

  const pool = await loadPrizePoolPosition(id);
  if (!pool.ok) {
    return internalErrorResponse(
      `Prize funding: failed to load the pool of tournament ${id}`,
      pool.error,
    );
  }

  const { data: fundings, error } = await supabaseAdmin
    .from("prize_fundings")
    .select("id, funder_name, funder_email, amount_cents, status, checkout_url, paid_at, created_at")
    .eq("tournament_id", id)
    .order("created_at", { ascending: false });
  if (error) {
    return internalErrorResponse(
      `Prize funding: failed to list the fundings of tournament ${id}`,
      error,
    );
  }

  return NextResponse.json({
    data: { pool: pool.position, fundings: fundings ?? [] },
  });
}

/**
 * Asks a funder for money: creates a prize_fundings row and its CHIP checkout,
 * and returns the link to forward. Owner only (payout.request): it is money.
 *
 * Body: { funder_name, funder_email, amount_cents? }. An omitted amount is
 * everything the pool still needs; an explicit one may not exceed that, so a
 * pool is never deliberately over-funded. Several links may be out at once (a
 * pool can have several sponsors); if more is paid in than was declared, the
 * surplus is returned to the funders like any other residual.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.request");
  if (!auth.ok) return auth.response;

  let body: { funder_name?: unknown; funder_email?: unknown; amount_cents?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid request body", 400);
  }

  const funderName = typeof body.funder_name === "string" ? body.funder_name.trim() : "";
  if (!funderName || funderName.length > 255) {
    return errorResponse(
      "VALIDATION_ERROR",
      "funder_name is required (255 characters or fewer)",
      400,
    );
  }
  const funderEmail =
    typeof body.funder_email === "string" ? body.funder_email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(funderEmail) || funderEmail.length > 255) {
    return errorResponse("VALIDATION_ERROR", "funder_email must be a valid email address", 400);
  }
  if (
    body.amount_cents !== undefined &&
    body.amount_cents !== null &&
    !(Number.isSafeInteger(body.amount_cents) && (body.amount_cents as number) > 0)
  ) {
    return errorResponse(
      "VALIDATION_ERROR",
      "amount_cents must be a positive whole number of cents",
      400,
    );
  }

  const loaded = await loadTournament(orgId, id);
  if ("response" in loaded) return loaded.response;
  const { tournament } = loaded;

  if (tournament.prizes?.distribution !== "platform") {
    return errorResponse(
      "NOT_PLATFORM_DISTRIBUTED",
      "This tournament's winners are paid by the organizer, so there is no prize pool to fund",
      409,
    );
  }
  if (tournament.status === "cancelled") {
    return errorResponse("TOURNAMENT_CANCELLED", "This tournament has been cancelled", 409);
  }

  const pool = await loadPrizePoolPosition(id);
  if (!pool.ok) {
    return internalErrorResponse(
      `Prize funding: failed to load the pool of tournament ${id}`,
      pool.error,
    );
  }
  const remaining = unfundedCents(pool.position);
  if (remaining <= 0) {
    return errorResponse("POOL_ALREADY_FUNDED", "The prize pool is already fully funded", 409);
  }
  const amountCents = (body.amount_cents as number | null | undefined) ?? remaining;
  if (amountCents > remaining) {
    return errorResponse(
      "EXCEEDS_REMAINING",
      `The pool needs ${formatRinggit(remaining)} more, so a contribution can't be larger than that`,
      409,
    );
  }

  const { data: row, error: insertError } = await supabaseAdmin
    .from("prize_fundings")
    .insert({
      tournament_id: id,
      funder_name: funderName,
      funder_email: funderEmail,
      amount_cents: amountCents,
      created_by: auth.userId,
    })
    .select("id")
    .single();
  if (insertError || !row) {
    return internalErrorResponse(
      `Prize funding: failed to record a contribution to tournament ${id}`,
      insertError,
    );
  }
  const fundingId = (row as { id: string }).id;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  let purchase: PurchasesResponse;
  try {
    purchase = await createChipPurchase({
      purchase: {
        currency: "MYR",
        products: [
          {
            name: `Prize fund — ${tournament.name}`,
            price: amountCents,
            quantity: "1",
          },
        ],
      },
      client: { email: funderEmail, full_name: funderName },
      // The webhook correlates on this when the purchase id wasn't recorded.
      reference: fundingId,
      success_redirect: `${siteUrl}/prize-funding/thank-you`,
      failure_redirect: `${siteUrl}/prize-funding/thank-you?status=failed`,
      send_receipt: true,
      // No `due`: unlike a registration there is no seat being held, and a
      // sponsor may take days to pay.
    });
  } catch (err) {
    console.error(`Prize funding ${fundingId}: CHIP purchase creation failed`, err);
    // Nothing can be paid against it, so it shouldn't read as outstanding.
    const { error: failError } = await supabaseAdmin
      .from("prize_fundings")
      .update({ status: "failed" })
      .eq("id", fundingId)
      .eq("status", "pending");
    if (failError) {
      console.error(`Prize funding ${fundingId}: failed to mark it failed`, failError.message);
    }
    return errorResponse(
      "PAYMENT_GATEWAY_ERROR",
      "Unable to create a payment link. Please try again.",
      503,
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from("prize_fundings")
    .update({
      chip_transaction_id: purchase.id,
      checkout_url: purchase.checkout_url,
    })
    .eq("id", fundingId);
  if (updateError) {
    // The webhook still correlates on `reference`, so the money isn't lost;
    // the link just won't be listed until someone looks.
    console.error(
      `Prize funding ${fundingId}: failed to persist CHIP purchase ${purchase.id}`,
      updateError.message,
    );
  }

  return NextResponse.json(
    {
      data: {
        id: fundingId,
        amount_cents: amountCents,
        checkout_url: purchase.checkout_url,
      },
    },
    { status: 201 },
  );
}
