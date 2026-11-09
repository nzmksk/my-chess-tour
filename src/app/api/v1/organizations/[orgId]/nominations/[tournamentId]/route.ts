import { supabaseAdmin } from "@/services/supabase/admin";
import { authorizeOrgPermission, UUID_RE } from "@/app/api/v1/organizations/_lib/authorize-org";
import { nominationErrorResponse } from "@/app/api/v1/organizations/_lib/nomination-errors";
import { NextRequest, NextResponse } from "next/server";

/**
 * Accepts a payout nomination on behalf of this organization. From this point the
 * tournament's payout comes here, unless the nomination is frozen first by a player
 * paying.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; tournamentId: string }> },
): Promise<NextResponse> {
  const { orgId, tournamentId } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.request");
  if (!auth.ok) return auth.response;

  if (!UUID_RE.test(tournamentId)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid tournament ID" } },
      { status: 400 },
    );
  }

  // The RPC checks the permission against the org the tournament actually names,
  // which may not be the one in this URL.
  const { data: nominated, error: lookupError } = await supabaseAdmin
    .from("tournaments")
    .select("id")
    .eq("id", tournamentId)
    .eq("beneficiary_organization_id", orgId)
    .maybeSingle();

  if (lookupError) {
    console.error(
      `Payout nomination: failed to look up tournament ${tournamentId}`,
      lookupError.message,
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: lookupError.message } },
      { status: 500 },
    );
  }
  if (!nominated) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Nomination not found" } },
      { status: 404 },
    );
  }

  const { data, error } = await supabaseAdmin.rpc("accept_payout_nomination", {
    p_tournament_id: tournamentId,
    p_user_id: auth.userId,
  });

  if (error) {
    return nominationErrorResponse(error, `accepting the nomination for tournament ${tournamentId}`);
  }

  return NextResponse.json({ data }, { status: 200 });
}
