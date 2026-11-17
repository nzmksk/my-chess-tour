import { supabaseAdmin } from "@/services/supabase/admin";
import {
  authorizeOrgPermission,
  UUID_RE,
} from "@/app/api/v1/organizations/_lib/authorize-org";
import { invitationErrorResponse } from "@/app/api/v1/organizations/_lib/invitation-errors";
import { NextRequest, NextResponse } from "next/server";

/**
 * Revokes a pending invitation, so its link stops working now rather than at
 * expiry: e.g. one sent to a mistyped address. Needs org.invite.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeOrgPermission(orgId, "org.invite");
  if (!auth.ok) return auth.response;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid invitation ID" } },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin.rpc("revoke_organization_invitation", {
    p_invitation_id: id,
    p_org_id: orgId,
    p_user_id: auth.userId,
  });

  if (error) {
    return invitationErrorResponse(error, `revoking invitation ${id}`);
  }

  return NextResponse.json({ data }, { status: 200 });
}
