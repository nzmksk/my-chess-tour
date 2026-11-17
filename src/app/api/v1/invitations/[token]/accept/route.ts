import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { invitationErrorResponse } from "@/app/api/v1/organizations/_lib/invitation-errors";
import {
  hashInvitationToken,
  INVITATION_TOKEN_RE,
} from "@/services/organizations/invitations";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ token: string }> };

/**
 * Accepts an organization invitation as the signed-in user, who must be signed
 * in with the address it was sent to (accept_organization_invitation checks).
 * Grants the membership with the offered role. Accepting twice is not an error.
 */
export async function POST(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { token } = await params;

  if (!INVITATION_TOKEN_RE.test(token)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Invitation not found" } },
      { status: 404 },
    );
  }

  const claims = await getAuthClaims();
  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const { data, error } = await supabaseAdmin.rpc("accept_organization_invitation", {
    p_token_hash: hashInvitationToken(token),
    p_user_id: claims.id,
  });

  if (error) {
    return invitationErrorResponse(error, "accepting an invitation");
  }

  return NextResponse.json({ data }, { status: 200 });
}
