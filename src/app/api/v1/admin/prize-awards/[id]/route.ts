import { supabaseAdmin } from "@/services/supabase/admin";
import { executePrizeAward } from "@/services/prizes/execute";
import { notifyPrizeAwarded } from "@/services/prizes/notify";
import { describePrizeAwardRefusal } from "@/services/prizes/problems";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { afterResponse, inOrderAfterResponse } from "@/lib/http/after-response";
import { authorizePlatformAdmin, errorResponse, UUID_RE } from "../authorize";
import { withAuditContext } from "@/services/supabase/audit-context";

// Approving emails the winner and sends the prize; templates are read from disk.
export const runtime = "nodejs";

/**
 * A platform admin approves or rejects an entered prize award (#523). Approve
 * is where the hard guard runs (review_prize_award): the pool must be fully
 * funded and the award must fit in what is still uncommitted, under the
 * tournament lock. It moves no money itself: the prize is sent afterwards
 * through executePrizeAward, and the response says what happened. A send that
 * can't go out yet (no verified bank account, no budget) leaves the award
 * approved and pending, and the daily run or the winner's own save sends it.
 *
 * Body: { action: "approve" | "reject", rejection_reason? }.
 */
async function handlePatch(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errorResponse("VALIDATION_ERROR", "Invalid prize award ID", 400);

  const auth = await authorizePlatformAdmin("Admin prize review");
  if (!auth.ok) return auth.response;

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
  if (action === "reject" && (typeof rejection_reason !== "string" || !rejection_reason.trim())) {
    return errorResponse(
      "VALIDATION_ERROR",
      "rejection_reason must be a non-empty string when rejecting",
      400,
    );
  }

  const { data, error } = await supabaseAdmin.rpc("review_prize_award", {
    p_award_id: id,
    p_reviewer_id: auth.userId,
    p_action: action,
    p_rejection_reason: action === "reject" ? (rejection_reason as string).trim() : null,
  });

  if (error) {
    if (error.code === "P0002") return errorResponse("NOT_FOUND", "Prize award not found", 404);
    if (error.code === "P0001") {
      console.warn(`Admin prize review: refused award ${id}`, error.message);
      return errorResponse(
        "CONFLICT",
        describePrizeAwardRefusal(error.message) ?? "This award can't be reviewed now.",
        409,
      );
    }
    return internalErrorResponse(`Admin prize review: review_prize_award failed for ${id}`, error);
  }

  // "You've been awarded" goes out before a "paid" email from a transfer CHIP
  // completes synchronously.
  const outcome = await inOrderAfterResponse(async () => {
    if (action !== "approve") return undefined;
    afterResponse(() => notifyPrizeAwarded(id));
    return executePrizeAward(id);
  });
  console.info(
    `Admin prize review: admin ${auth.userId} ${action === "approve" ? "approved" : "rejected"} award ${id}${outcome ? `: ${outcome}` : ""}`,
  );

  return NextResponse.json(
    { data: { ...(data as Record<string, unknown>), ...(outcome ? { outcome } : {}) } },
    { status: 200 },
  );
}

export const PATCH = withAuditContext("admin.prize-award.review", handlePatch);
