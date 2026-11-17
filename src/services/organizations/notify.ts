import { supabaseAdmin } from "@/services/supabase/admin";
import {
  type MemberInvitationRole,
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

/**
 * Tells the applicant the outcome of their organization application: approved, or
 * declined with the admin's reason. Also goes to the contact address given on the
 * application when it differs, since that is where the organization expects mail.
 *
 * Best-effort and never throws: it runs after review_organization_application has
 * committed, and reads the outcome back from the row rather than trusting the
 * caller.
 */
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

    // The applicant first, so someone who also gave their own address as the
    // contact is greeted by name.
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

/**
 * Emails an invitation to join an organization. `email` need not belong to an
 * account yet; when it does, the email greets them by name.
 *
 * Runs after the invitation is written, and never throws: the invitation stands
 * either way and can be resent from the members page. Resolves to whether the
 * email went out, so the inviter can be told when it didn't.
 */
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
