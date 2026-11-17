import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { UUID_RE } from "@/app/api/v1/organizations/_lib/authorize-org";
import { invitationErrorResponse } from "@/app/api/v1/organizations/_lib/invitation-errors";
import { notifyInvitationResponded } from "@/services/organizations/notify";
import { NextResponse } from "next/server";

/**
 * Accepts or declines one of the signed-in user's own invitations, by id. The
 * database functions check that the user is the invited address for both, since
 * there is no emailed token to prove it here. Shared by the accept and decline
 * routes; tells the inviter about a fresh answer.
 */
export async function respondToOwnInvitation(
  id: string,
  accept: boolean,
): Promise<NextResponse> {
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid invitation ID" } },
      { status: 400 },
    );
  }

  const claims = await getAuthClaims();
  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const { data, error } = accept
    ? await supabaseAdmin.rpc("accept_organization_invitation_by_id", {
        p_invitation_id: id,
        p_user_id: claims.id,
      })
    : await supabaseAdmin.rpc("decline_organization_invitation_by_id", {
        p_invitation_id: id,
        p_user_id: claims.id,
      });

  if (error) {
    return invitationErrorResponse(
      error,
      `${accept ? "accepting" : "declining"} invitation ${id}`,
    );
  }

  // A repeated answer (double-click, retry) changes nothing and tells no one.
  const result = data as {
    invitation_id: string;
    already_accepted?: boolean;
    already_declined?: boolean;
  };
  if (!(accept ? result.already_accepted : result.already_declined)) {
    await notifyInvitationResponded(result.invitation_id);
  }

  return NextResponse.json({ data }, { status: 200 });
}
