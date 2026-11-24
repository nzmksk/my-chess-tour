import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { withAuditContext } from "@/services/supabase/audit-context";
import {
  INVITATION_TOKEN_RE,
  hashInvitationToken,
} from "@/services/organizations/invitations";
import { helperErrorResponse } from "@/services/guardianship/helpers";

type Params = { params: Promise<{ token: string }> };

async function handlePost(
  _request: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  const { token } = await params;

  if (!INVITATION_TOKEN_RE.test(token)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Invitation not found" } },
      { status: 404 },
    );
  }

  const claims = await getAuthClaims();

  const { data, error } = await supabaseAdmin.rpc("decline_helper_invitation", {
    p_token_hash: hashInvitationToken(token),
    p_user_id: claims?.id ?? null,
  });
  if (error) return helperErrorResponse(error, "declining a helper invitation");

  return NextResponse.json({ data }, { status: 200 });
}

export const POST = withAuditContext("helper.decline", handlePost);
