import { supabaseAdmin } from "@/services/supabase/admin";
import { canRetryAward } from "@/services/prizes/awards";
import { executePrizeAward } from "@/services/prizes/execute";
import { NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { authorizePlatformAdmin, errorResponse, UUID_RE } from "../../authorize";

// executePrizeAward can send email, whose templates are read from disk.
export const runtime = "nodejs";

/**
 * Re-runs the send of an approved prize award that didn't go out (#523): one
 * waiting on budget or on the winner's bank account, or interrupted by a
 * transient failure. The daily run does the same; this is for an admin who
 * doesn't want to wait. Safe to call any number of times: CHIP dedupes on the
 * award id and a settled award is left alone.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errorResponse("VALIDATION_ERROR", "Invalid prize award ID", 400);

  const auth = await authorizePlatformAdmin("Admin prize send");
  if (!auth.ok) return auth.response;

  const { data: award, error } = await supabaseAdmin
    .from("prize_awards")
    .select("approval, status, processed_at, chip_send_instruction_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return internalErrorResponse(`Admin prize send: failed to load award ${id}`, error);
  if (!award) return errorResponse("NOT_FOUND", "Prize award not found", 404);
  if (!canRetryAward(award)) {
    return errorResponse(
      "NOT_RESENDABLE",
      award.approval !== "approved"
        ? "Only an approved award can be sent."
        : "This award is already with CHIP or settled.",
      409,
    );
  }

  const outcome = await executePrizeAward(id);
  console.info(`Admin prize send: admin ${auth.userId} re-ran award ${id}: ${outcome}`);
  return NextResponse.json({ data: { award_id: id, outcome } }, { status: 200 });
}
