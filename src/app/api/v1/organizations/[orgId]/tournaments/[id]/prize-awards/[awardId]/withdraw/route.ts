import { supabaseAdmin } from "@/services/supabase/admin";
import {
  authorizeOrgPermission,
  UUID_RE,
} from "@/app/api/v1/organizations/_lib/authorize-org";
import { describePrizeAwardRefusal } from "@/services/prizes/problems";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { withAuditContext } from "@/services/supabase/audit-context";

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

async function handlePost(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ orgId: string; id: string; awardId: string }> },
): Promise<NextResponse> {
  const { orgId, id, awardId } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.request");
  if (!auth.ok) return auth.response;

  if (!UUID_RE.test(id))
    return errorResponse("VALIDATION_ERROR", "Invalid tournament ID", 400);
  if (!UUID_RE.test(awardId))
    return errorResponse("VALIDATION_ERROR", "Invalid prize award ID", 400);

  const { data: tournament, error: tournamentError } = await supabaseAdmin
    .from("tournaments")
    .select("id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (tournamentError) {
    return internalErrorResponse(
      `Prize awards: failed to load tournament ${id}`,
      tournamentError,
    );
  }
  if (!tournament)
    return errorResponse("NOT_FOUND", "Tournament not found", 404);

  const { data, error } = await supabaseAdmin.rpc("withdraw_prize_award", {
    p_tournament_id: id,
    p_award_id: awardId,
    p_withdrawn_by: auth.userId,
  });

  if (error) {
    if (error.code === "P0002")
      return errorResponse("NOT_FOUND", "Prize award not found", 404);
    if (error.code === "P0001") {
      console.warn(
        `Prize awards: refused to withdraw award ${awardId}`,
        error.message,
      );
      return errorResponse(
        "PRIZE_AWARD_REFUSED",
        describePrizeAwardRefusal(error.message) ??
          "This award can no longer be withdrawn.",
        409,
      );
    }
    return internalErrorResponse(
      `Prize awards: withdraw_prize_award failed for ${awardId}`,
      error,
    );
  }

  return NextResponse.json({ data });
}

export const POST = withAuditContext("prize-award.withdraw", handlePost);
