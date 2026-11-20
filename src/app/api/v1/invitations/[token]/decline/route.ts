import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { invitationErrorResponse } from "@/app/api/v1/organizations/_lib/invitation-errors";
import {
  hashInvitationToken,
  INVITATION_TOKEN_RE,
} from "@/services/organizations/invitations";
import { notifyInvitationResponded } from "@/services/organizations/notify";
import { NextRequest, NextResponse } from "next/server";
import { afterResponse } from "@/lib/http/after-response";
import { withAuditContext } from "@/services/supabase/audit-context";

// Answering emails the inviter, and email templates are read from disk.
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

/**
 * Declines an organization invitation. Holding the link is enough: declining
 * grants nothing, and someone who doesn't want an account shouldn't need one to
 * say no. When the caller is signed in they are recorded as the one who declined.
 */
async function handlePost(_request: NextRequest, { params }: Params): Promise<NextResponse> {
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

  // A repeated answer (double-click, retry) changes nothing and tells no one.
  const result = data as { invitation_id: string; already_declined?: boolean };
  if (!result.already_declined) {
    afterResponse(() => notifyInvitationResponded(result.invitation_id));
  }

  return NextResponse.json({ data }, { status: 200 });
}

export const POST = withAuditContext("invitation.decline", handlePost);
