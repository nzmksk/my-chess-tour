import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { withAuditContext } from "@/services/supabase/audit-context";
import { UUID_RE } from "@/app/api/v1/organizations/_lib/authorize-org";
import { helperErrorResponse } from "@/services/guardianship/helpers";

async function handleDelete(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const claims = await getAuthClaims();
  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Invitation not found" } },
      { status: 404 },
    );
  }

  const { data, error } = await supabaseAdmin.rpc("revoke_helper_invitation", {
    p_player_user_id: claims.id,
    p_invitation_id: id,
  });
  if (error)
    return helperErrorResponse(error, "withdrawing a helper invitation");

  return NextResponse.json({ data });
}

export const DELETE = withAuditContext("helper.invite.revoke", handleDelete);
