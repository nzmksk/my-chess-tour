import { supabaseAdmin } from "@/services/supabase/admin";
import { authorizeOrgPermission, UUID_RE } from "@/app/api/v1/organizations/_lib/authorize-org";
import { nominationErrorResponse } from "@/app/api/v1/organizations/_lib/nomination-errors";
import {
  BENEFICIARY_LOCK_COLUMNS,
  beneficiaryLockResponse,
} from "@/app/api/v1/organizations/_lib/beneficiary-lock";
import { notifyBeneficiaryNominated } from "@/services/payouts/notify";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

// Nominating emails the nominee, and email templates are read from disk.
export const runtime = "nodejs";

/**
 * Nominates another organization to receive this tournament's payout, or withdraws
 * the nomination with `beneficiary_organization_id: null`. It redirects nothing until
 * the nominee accepts. Owner only: this decides where money goes.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.request");
  if (!auth.ok) return auth.response;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid tournament ID" } },
      { status: 400 },
    );
  }

  let body: { beneficiary_organization_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  const beneficiary = body.beneficiary_organization_id;
  if (beneficiary !== null && (typeof beneficiary !== "string" || !UUID_RE.test(beneficiary))) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "beneficiary_organization_id must be a valid ID or null",
        },
      },
      { status: 400 },
    );
  }

  // The RPC checks the permission against the tournament's own organization, which
  // may not be the one in this URL.
  const { data: tournament, error: lookupError } = await supabaseAdmin
    .from("tournaments")
    .select(`id, ${BENEFICIARY_LOCK_COLUMNS}`)
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (lookupError) {
    return internalErrorResponse(
      `Payout beneficiary: failed to look up tournament ${id}`,
      lookupError,
    );
  }
  if (!tournament) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Tournament not found" } },
      { status: 404 },
    );
  }

  // Locked once the tournament starts. The RPC and the paid-fields trigger
  // cover cancellation and payment, but not the dates.
  const locked = beneficiaryLockResponse(tournament);
  if (locked) return locked;

  const { data, error } = await supabaseAdmin.rpc("nominate_payout_beneficiary", {
    p_tournament_id: id,
    p_beneficiary_org_id: beneficiary,
    p_user_id: auth.userId,
  });

  if (error) {
    return nominationErrorResponse(error, `nominating a beneficiary for tournament ${id}`);
  }

  // The nominee has to accept before anything is redirected, so tell it.
  if (beneficiary) {
    await notifyBeneficiaryNominated(id, beneficiary);
  }

  return NextResponse.json({ data }, { status: 200 });
}
