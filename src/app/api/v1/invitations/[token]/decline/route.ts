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
 * Declines an organization invitation. Holding the link is enough: declining
 * grants nothing, and someone who doesn't want an account shouldn't need one to
 * say no. When the caller is signed in they are recorded as the one who declined.
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

  const { data, error } = await supabaseAdmin.rpc("decline_organization_invitation", {
    p_token_hash: hashInvitationToken(token),
    p_user_id: claims?.id ?? null,
  });

  if (error) {
    return invitationErrorResponse(error, "declining an invitation");
  }

  return NextResponse.json({ data }, { status: 200 });
}
