import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { loadAdminPayoutQueue } from "@/services/payouts/admin-queue";
import { executePayout } from "@/services/payouts/execute";
import {
  describeBlockReason,
  describeRecipientProblem,
} from "@/services/payouts/recipient-problem";
import { NextRequest, NextResponse } from "next/server";

// executePayout can send email, whose templates are read from disk.
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

// Returns the admin's user id, or the response to send instead.
async function authorizeAdmin(): Promise<
  { userId: string } | { response: NextResponse }
> {
  const claims = await getAuthClaims();
  if (!claims) {
    return { response: errorResponse("UNAUTHORIZED", "Authentication required", 401) };
  }

  const supabase = await createClient();
  const { data: isAdmin, error } = await supabase.rpc("has_global_permission", {
    p_user_id: claims.id,
    p_permission: "platform.manage",
  });

  if (error) {
    console.error("Admin payouts: permission check failed", error.message);
    return { response: errorResponse("INTERNAL_ERROR", error.message, 500) };
  }
  if (!isAdmin) {
    return { response: errorResponse("FORBIDDEN", "Admin access required", 403) };
  }
  return { userId: claims.id };
}

/** The payout queue, plus what could be paid out right now. */
export async function GET(): Promise<NextResponse> {
  const auth = await authorizeAdmin();
  if ("response" in auth) return auth.response;

  const { data, error } = await loadAdminPayoutQueue();
  if (error) {
    console.error("Admin payouts: failed to load the payout queue", error);
    return errorResponse("INTERNAL_ERROR", error, 500);
  }

  return NextResponse.json({ data }, { status: 200 });
}

// queue_payout raises "SENTINEL: detail". The detail may be a code, so turn the
// known ones into something an admin can act on.
function queueErrorMessage(message: string): string {
  const [sentinel, ...rest] = message.split(": ");
  const detail = rest.join(": ");
  switch (sentinel) {
    case "PAYOUT_BLOCKED":
      return describeBlockReason(detail);
    case "PAYOUT_RECIPIENT_INELIGIBLE":
      return describeRecipientProblem(detail);
    case "PAYOUT_BELOW_MINIMUM":
      return `Below the minimum payout: ${detail}.`;
    default:
      return message;
  }
}

/**
 * Admin-triggered payout: queues it (the money state, in one transaction), then
 * sends it best-effort. An omitted amount means everything available.
 *
 * `outcome` is passed through because "queued" isn't "paid": a payout short of
 * budget is parked and retried, and the admin should be told so.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeAdmin();
  if ("response" in auth) return auth.response;

  let body: { tournament_id?: unknown; amount_cents?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid request body", 400);
  }

  const { tournament_id, amount_cents } = body;

  if (typeof tournament_id !== "string" || !UUID_RE.test(tournament_id)) {
    return errorResponse("VALIDATION_ERROR", "tournament_id must be a valid ID", 400);
  }

  if (
    amount_cents !== undefined &&
    amount_cents !== null &&
    (!Number.isSafeInteger(amount_cents) || (amount_cents as number) <= 0)
  ) {
    return errorResponse(
      "VALIDATION_ERROR",
      "amount_cents must be a positive whole number of cents",
      400,
    );
  }

  const { data: payoutId, error } = await supabaseAdmin.rpc("queue_payout", {
    p_tournament_id: tournament_id,
    p_kind: "automatic",
    p_amount_cents: amount_cents ?? null,
    p_requested_by: auth.userId,
  });

  if (error) {
    if (error.code === "P0002") {
      return errorResponse("NOT_FOUND", "Tournament not found", 404);
    }
    if (error.code === "P0001") {
      // Expected refusals (blocked, ineligible recipient, below minimum), but worth
      // a trace when someone asks why a payout never went out.
      console.warn(
        `Admin payouts: queue_payout refused tournament ${tournament_id}`,
        error.message,
      );
      return errorResponse("CONFLICT", queueErrorMessage(error.message), 409);
    }
    console.error(
      `Admin payouts: queue_payout failed for tournament ${tournament_id}`,
      error.code ? `${error.code}: ${error.message}` : error.message,
    );
    return errorResponse("INTERNAL_ERROR", error.message, 500);
  }

  if (!payoutId) {
    console.warn(
      `Admin payouts: tournament ${tournament_id} already has a live automatic payout`,
    );
    return errorResponse(
      "PAYOUT_EXISTS",
      "This tournament already has an automatic payout",
      409,
    );
  }

  const outcome = await executePayout(payoutId as string);
  console.info(
    `Admin payouts: admin ${auth.userId} queued payout ${payoutId} for tournament ${tournament_id}: ${outcome}`,
  );

  return NextResponse.json({ data: { payout_id: payoutId, outcome } }, { status: 201 });
}
