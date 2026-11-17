import { supabaseAdmin } from "@/services/supabase/admin";
import { authorizeOrgPermission } from "@/app/api/v1/organizations/_lib/authorize-org";
import { invitationErrorResponse } from "@/app/api/v1/organizations/_lib/invitation-errors";
import { notifyMemberInvited } from "@/services/organizations/notify";
import {
  daysUntil,
  generateInvitationToken,
  hashInvitationToken,
  invitationUrl,
} from "@/services/organizations/invitations";
import { NextRequest, NextResponse } from "next/server";
import { validateInviteRequest } from "./validators";

// Inviting emails the invitee, and email templates are read from disk.
export const runtime = "nodejs";

interface CreatedInvitation {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  resent: boolean;
}

/**
 * Invites an email address to join the organization. Nothing is granted here:
 * the invitee accepts or declines from the emailed link (POST
 * /api/v1/invitations/[token]/accept or /decline), and the invitation expires
 * after 30 days. Inviting an address that already has a pending invitation
 * refreshes it with a new link, role and expiry — that is also how one is resent.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  const auth = await authorizeOrgPermission(orgId, "org.invite");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  const validation = validateInviteRequest(body);
  if ("error" in validation) {
    return validation.error;
  }
  const { email, role } = validation.data;

  // The token only ever travels in the email; the database keeps its hash.
  const token = generateInvitationToken();
  const { data, error } = await supabaseAdmin.rpc(
    "create_organization_invitation",
    {
      p_org_id: orgId,
      p_email: email,
      p_role: role,
      p_invited_by: auth.userId,
      p_token_hash: hashInvitationToken(token),
    },
  );

  if (error) {
    return invitationErrorResponse(error, `inviting to organization ${orgId}`);
  }

  const invitation = data as CreatedInvitation;

  // The invitation stands whether or not the email goes out; email_sent lets
  // the members page say so, and the inviter can resend.
  const emailSent = await notifyMemberInvited({
    orgId,
    inviterId: auth.userId,
    email,
    role,
    invitationUrl: invitationUrl(token),
  });

  return NextResponse.json(
    {
      data: {
        id: invitation.id,
        email,
        role,
        status: "pending",
        invited_at: invitation.created_at,
        expires_at: invitation.expires_at,
        days_left: daysUntil(invitation.expires_at),
        resent: invitation.resent,
        email_sent: emailSent,
      },
    },
    { status: 201 },
  );
}
