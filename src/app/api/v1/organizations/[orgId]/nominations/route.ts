import { supabaseAdmin } from "@/services/supabase/admin";
import { authorizeOrgPermission } from "@/app/api/v1/organizations/_lib/authorize-org";
import {
  BENEFICIARY_LOCK_COLUMNS,
  beneficiaryStage,
  type BeneficiaryLockTournament,
} from "@/app/api/v1/organizations/_lib/beneficiary-lock";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

/**
 * Payout nominations waiting on this organization. Gated on payout.request, the
 * permission needed to act on one, so the dashboard panel only appears for people
 * who can use it.
 *
 * Only nominations that can still be answered are listed. The RPC leaves out
 * cancelled and paid tournaments; this leaves out the ones that have started,
 * which the accept and decline routes refuse. The date stages aren't in SQL
 * (see src/lib/tournaments/edit-policy.ts), so that filter is here.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.request");
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin.rpc("list_pending_payout_nominations", {
    p_org_id: orgId,
  });

  if (error) {
    return internalErrorResponse(
      `Organization ${orgId} nominations: failed to load`,
      error,
    );
  }

  const pending = (data ?? []) as Array<{ tournament_id: string }>;
  if (pending.length === 0) {
    return NextResponse.json({ data: [] }, { status: 200 });
  }

  const { data: tournaments, error: lockError } = await supabaseAdmin
    .from("tournaments")
    .select(`id, ${BENEFICIARY_LOCK_COLUMNS}`)
    .in(
      "id",
      pending.map((n) => n.tournament_id),
    );

  if (lockError) {
    return internalErrorResponse(
      `Organization ${orgId} nominations: failed to load tournament dates`,
      lockError,
    );
  }

  const open = new Set(
    ((tournaments ?? []) as Array<BeneficiaryLockTournament & { id: string }>)
      .filter((t) => beneficiaryStage(t).editable)
      .map((t) => t.id),
  );

  return NextResponse.json(
    { data: pending.filter((n) => open.has(n.tournament_id)) },
    { status: 200 },
  );
}
