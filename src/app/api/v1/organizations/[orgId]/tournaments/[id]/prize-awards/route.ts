import { supabaseAdmin } from "@/services/supabase/admin";
import {
  authorizeOrgPermission,
  UUID_RE,
} from "@/app/api/v1/organizations/_lib/authorize-org";
import { listTournamentAwards } from "@/services/prizes/awards";
import { notifyAdminsOfPrizes } from "@/services/prizes/notify";
import { loadPrizePoolPosition } from "@/services/prizes/pool";
import { describePrizeAwardRefusal } from "@/services/prizes/problems";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { afterResponse } from "@/lib/http/after-response";

// Entering a winner alerts the platform admins, and templates are read from disk.
export const runtime = "nodejs";

// The platform-managed prize pool, money out (#523): the organizer names each
// winner after the event; a platform admin approves before any money moves
// (PATCH /api/v1/admin/prize-awards/[id]). Only for a tournament whose prizes
// MY Chess Tour distributes.

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

async function tournamentInOrg(
  orgId: string,
  id: string,
): Promise<NextResponse | null> {
  if (!UUID_RE.test(id)) return errorResponse("VALIDATION_ERROR", "Invalid tournament ID", 400);
  const { data, error } = await supabaseAdmin
    .from("tournaments")
    .select("id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) {
    return internalErrorResponse(`Prize awards: failed to load tournament ${id}`, error);
  }
  return data ? null : errorResponse("NOT_FOUND", "Tournament not found", 404);
}

/** The tournament's awards and pool position, for payout viewers. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.view");
  if (!auth.ok) return auth.response;
  const missing = await tournamentInOrg(orgId, id);
  if (missing) return missing;

  const [awards, pool] = await Promise.all([listTournamentAwards(id), loadPrizePoolPosition(id)]);
  if (!awards.ok) {
    return internalErrorResponse(`Prize awards: failed to list awards of ${id}`, awards.error);
  }
  if (!pool.ok) {
    return internalErrorResponse(`Prize awards: failed to load the pool of ${id}`, pool.error);
  }
  return NextResponse.json({ data: { pool: pool.position, awards: awards.awards } });
}

/**
 * Names a winner. Body: { user_id, category, place?, amount_cents }. Owner only
 * (payout.request): a wrong name here becomes an irreversible transfer, so it
 * sits with the same people who decide where payouts go, and an admin checks it
 * again before approving. enter_prize_award does every check that can be done
 * in the database: the winner played, the prize is declared, a split fits.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.request");
  if (!auth.ok) return auth.response;

  let body: { user_id?: unknown; category?: unknown; place?: unknown; amount_cents?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid request body", 400);
  }

  if (typeof body.user_id !== "string" || !UUID_RE.test(body.user_id)) {
    return errorResponse("VALIDATION_ERROR", "user_id must be a valid ID", 400);
  }
  const category = typeof body.category === "string" ? body.category.trim() : "";
  if (!category || category.length > 255) {
    return errorResponse("VALIDATION_ERROR", "category is required", 400);
  }
  if (body.place !== undefined && body.place !== null && typeof body.place !== "string") {
    return errorResponse("VALIDATION_ERROR", "place must be text or null", 400);
  }
  const place = typeof body.place === "string" && body.place.trim() ? body.place.trim() : null;
  if (place && place.length > 50) {
    return errorResponse("VALIDATION_ERROR", "place must be 50 characters or fewer", 400);
  }
  if (!Number.isSafeInteger(body.amount_cents) || (body.amount_cents as number) <= 0) {
    return errorResponse("VALIDATION_ERROR", "amount_cents must be a positive whole number of cents", 400);
  }
  const amountCents = body.amount_cents as number;

  const missing = await tournamentInOrg(orgId, id);
  if (missing) return missing;

  const { data, error } = await supabaseAdmin.rpc("enter_prize_award", {
    p_tournament_id: id,
    p_user_id: body.user_id,
    p_category: category,
    p_place: place,
    p_amount_cents: amountCents,
    p_entered_by: auth.userId,
  });

  if (error) {
    if (error.code === "23505") {
      return errorResponse("ALREADY_AWARDED", "This player already holds that prize", 409);
    }
    if (error.code === "P0001") {
      console.warn(`Prize awards: refused an award for tournament ${id}`, error.message);
      return errorResponse(
        "PRIZE_AWARD_REFUSED",
        describePrizeAwardRefusal(error.message) ?? "This prize award isn't allowed now.",
        409,
      );
    }
    if (error.code === "P0002") return errorResponse("NOT_FOUND", "Tournament not found", 404);
    return internalErrorResponse(`Prize awards: enter_prize_award failed for ${id}`, error);
  }

  afterResponse(() =>
    notifyAdminsOfPrizes(
      id,
      "prize_review",
      amountCents,
      `${category}${place ? ` — ${place}` : ""}`,
    ),
  );

  return NextResponse.json({ data: { id: data as string } }, { status: 201 });
}
