import { supabaseAdmin } from "@/services/supabase/admin";
import {
  type MemberInvitationRole,
  sendInvitationResponseEmail,
  sendMemberInvitationEmail,
  sendOrganizerApplicationReviewEmail,
} from "@/services/email/email";
import {
  addRecipient,
  type EmailRecipient,
  sendToAll,
} from "@/services/email/recipients";
import { personName } from "./invitations";

interface ReviewedApplicationRow {
  id: string;
  name: string | null;
  email: string | null;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  applicant: { email: string | null; first_name: string | null } | null;
}

export async function notifyApplicationReviewed(orgId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("organizations")
      .select(
        `id, name, email, approval_status, rejection_reason,
         applicant:users!created_by(email, first_name)`,
      )
      .eq("id", orgId)
      .single();
    if (error || !data) {
      console.error(
        `Organization ${orgId}: failed to load application review email data`,
        error?.message,
      );
      return;
    }
    const org = data as unknown as ReviewedApplicationRow;
    if (org.approval_status === "pending") {
      console.error(
        `Organization ${orgId}: review email requested for an unreviewed application`,
      );
      return;
    }

    const recipients = new Map<string, EmailRecipient>();
    addRecipient(recipients, org.applicant?.email, org.applicant?.first_name);
    addRecipient(recipients, org.email, org.name);
    if (recipients.size === 0) {
      console.error(`Organization ${orgId}: no address to send the review email to`);
      return;
    }

    await sendToAll(
      recipients,
      (r) =>
        sendOrganizerApplicationReviewEmail(r.email, {
          recipientName: r.name,
          organizationName: org.name ?? "your organization",
          orgId: org.id,
          approved: org.approval_status === "approved",
          rejectionReason: org.rejection_reason ?? undefined,
        }),
      `application review email(s) for organization ${orgId}`,
    );
  } catch (err) {
    console.error(
      `Organization ${orgId}: application review email failed`,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function notifyMemberInvited(params: {
  orgId: string;
  inviterId: string;
  email: string;
  role: MemberInvitationRole;
  invitationUrl: string;
}): Promise<boolean> {
  const { orgId, inviterId, email, role, invitationUrl } = params;
  try {
    const [
      { data: org, error: orgError },
      { data: inviter, error: inviterError },
      { data: recipient, error: recipientError },
    ] = await Promise.all([
      supabaseAdmin.from("organizations").select("name").eq("id", orgId).single(),
      supabaseAdmin
        .from("users")
        .select("first_name, last_name")
        .eq("id", inviterId)
        .maybeSingle(),
      supabaseAdmin
        .from("users")
        .select("first_name")
        .eq("email", email)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);
    const loadError = orgError ?? inviterError ?? recipientError;
    if (loadError || !org) {
      console.error(
        `Organization ${orgId}: failed to load member invitation email data`,
        loadError?.message,
      );
      return false;
    }

    await sendMemberInvitationEmail(email, {
      recipientName:
        (recipient as { first_name: string | null } | null)?.first_name?.trim() ||
        "there",
      inviterName:
        personName(
          inviter as { first_name: string | null; last_name: string | null } | null,
        ) ?? "A teammate",
      organizationName: (org as { name: string }).name,
      role,
      invitationUrl,
    });
    return true;
  } catch (err) {
    console.error(
      `Organization ${orgId}: member invitation email failed`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

interface RespondedInvitationRow {
  id: string;
  email: string;
  status: "pending" | "accepted" | "declined" | "revoked";
  organization_id: string;
  roles: { name: string } | null;
  organizations: { name: string } | null;
  inviter: {
    email: string | null;
    first_name: string | null;
    deleted_at: string | null;
  } | null;
  responder: { first_name: string | null; last_name: string | null } | null;
}

export async function notifyInvitationResponded(invitationId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("organization_invitations")
      .select(
        `id, email, status, organization_id,
         roles(name),
         organizations(name),
         inviter:users!invited_by(email, first_name, deleted_at),
         responder:users!responded_by(first_name, last_name)`,
      )
      .eq("id", invitationId)
      .single();
    if (error || !data) {
      console.error(
        `Invitation ${invitationId}: failed to load response email data`,
        error?.message,
      );
      return;
    }

    const inv = data as unknown as RespondedInvitationRow;
    if (inv.status !== "accepted" && inv.status !== "declined") {
      console.error(
        `Invitation ${invitationId}: response email requested for a ${inv.status} invitation`,
      );
      return;
    }
    if (!inv.inviter?.email || inv.inviter.deleted_at) return;

    await sendInvitationResponseEmail(inv.inviter.email, {
      recipientName: inv.inviter.first_name?.trim() || "there",
      inviteeName: personName(inv.responder) ?? inv.email,
      inviteeEmail: inv.email,
      organizationName: inv.organizations?.name ?? "your organization",
      orgId: inv.organization_id,
      role: (inv.roles?.name ?? "member") as MemberInvitationRole,
      accepted: inv.status === "accepted",
    });
  } catch (err) {
    console.error(
      `Invitation ${invitationId}: response email failed`,
      err instanceof Error ? err.message : err,
    );
  }
}
