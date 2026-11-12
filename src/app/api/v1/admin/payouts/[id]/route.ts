import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { executePayout } from "@/services/payouts/execute";
import { formatRinggit, parseSentinel } from "@/services/payouts/format";
import { notifyPayoutReviewed } from "@/services/payouts/notify";
import { describeEarlyPayoutProblem } from "@/services/payouts/recipient-problem";
import { NextRequest, NextResponse } from "next/server";

// Approving sends the payout and both outcomes email the organization; email
// templates are read from disk.
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

async function checkAdminAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const claims = await getAuthClaims();
  if (!claims) {
    return { user: null, isAdmin: false, error: null };
  }
  const { data: isAdmin, error } = await supabase.rpc("has_global_permission", {
    p_user_id: claims.id,
    p_permission: "platform.manage",
  });
  return { user: claims, isAdmin: !!isAdmin, error };
}

// review_payout_request's P0001 refusals. On approve it re-runs every check the
// request made, so these say what changed while it waited.
function reviewConflictMessage(message: string): string {
  const parsed = parseSentinel(message);
  switch (parsed?.sentinel) {
    case "PAYOUT_ALREADY_REVIEWED":
      return "This payout request has already been reviewed";
    case "EARLY_PAYOUT_NOT_ALLOWED":
      return `This request can't be approved now. ${describeEarlyPayoutProblem(parsed.detail.trim())}`;
    case "EARLY_PAYOUT_EXCEEDS_CAP": {
      const match = parsed.detail.match(/^(\d+) cents requested, (\d+) cents can be paid early$/);
      return match
        ? `This request is for ${formatRinggit(Number(match[1]))}, but only ${formatRinggit(Number(match[2]))} can be paid early now. Reject it so the organizer can ask again.`
        : "This request is for more than can be paid early now.";
    }
    default:
      return "This payout request has already been reviewed";
  }
}

// Admin approves or rejects an organizer's early payout request. Approve only
// marks it approved (review_payout_request); the money moves afterwards through
// executePayout, best-effort, because a network call can't run in that
// transaction. A send that doesn't go through leaves the row pending, approved
// and safe to re-run, and the response says what happened.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return errorResponse("VALIDATION_ERROR", "Invalid payout ID", 400);
  }

  const supabase = await createClient();
  const {
    user,
    isAdmin,
    error: permissionError,
  } = await checkAdminAccess(supabase);

  if (!user) {
    return errorResponse("UNAUTHORIZED", "Authentication required", 401);
  }
  if (permissionError) {
    return errorResponse("INTERNAL_ERROR", permissionError.message, 500);
  }
  if (!isAdmin) {
    return errorResponse("FORBIDDEN", "Admin access required", 403);
  }

  let body: { action?: unknown; rejection_reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid request body", 400);
  }

  const { action, rejection_reason } = body;

  if (action !== "approve" && action !== "reject") {
    return errorResponse("VALIDATION_ERROR", "action must be 'approve' or 'reject'", 400);
  }

  if (
    action === "reject" &&
    (typeof rejection_reason !== "string" || !rejection_reason.trim())
  ) {
    return errorResponse(
      "VALIDATION_ERROR",
      "rejection_reason must be a non-empty string when rejecting",
      400,
    );
  }

  const { data, error } = await supabaseAdmin.rpc("review_payout_request", {
    p_payout_id: id,
    p_reviewer_id: user.id,
    p_action: action,
    p_rejection_reason:
      action === "reject" ? (rejection_reason as string).trim() : null,
  });

  if (error) {
    if (error.code === "P0002") {
      return errorResponse("NOT_FOUND", "Payout request not found", 404);
    }
    if (error.code === "P0001") {
      console.warn(`Admin payout review: refused payout ${id}`, error.message);
      return errorResponse("CONFLICT", reviewConflictMessage(error.message ?? ""), 409);
    }
    if (error.code === "22023") {
      return errorResponse("VALIDATION_ERROR", error.message, 400);
    }
    console.error(
      `Admin payout review: review_payout_request failed for payout ${id}`,
      error.code ? `${error.code}: ${error.message}` : error.message,
    );
    return errorResponse("INTERNAL_ERROR", error.message, 500);
  }

  // Before the send: a transfer CHIP completes synchronously emails "processed"
  // straight away, and that shouldn't arrive ahead of "approved".
  await notifyPayoutReviewed(id);

  // Never throws; a transient failure leaves the row approved and pending.
  const outcome = action === "approve" ? await executePayout(id) : undefined;
  console.info(
    `Admin payout review: admin ${user.id} ${action === "approve" ? "approved" : "rejected"} payout ${id}${outcome ? `: ${outcome}` : ""}`,
  );

  return NextResponse.json(
    { data: { ...(data as Record<string, unknown>), ...(outcome ? { outcome } : {}) } },
    { status: 200 },
  );
}
