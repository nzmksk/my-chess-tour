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

interface MemberInviteUserRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

/**
 * Tells someone they have joined an organization's team. Pass `acceptUrl` when
 * the invite created their account, so the email asks them to accept and set a
 * password; leave it out for an existing user, who is a member already.
 *
 * Runs after the membership row is written, and never throws: the membership
 * stands either way. Resolves to whether the email went out, so the caller can
 * tell the inviter when a new user's only way in was not delivered.
 */
export async function notifyMemberInvited(params: {
  orgId: string;
  inviterId: string;
  memberId: string;
  role: MemberInvitationRole;
  acceptUrl?: string;
}): Promise<boolean> {
  const { orgId, inviterId, memberId, role, acceptUrl } = params;
  try {
    const [
      { data: org, error: orgError },
      { data: users, error: usersError },
    ] = await Promise.all([
      supabaseAdmin.from("organizations").select("name").eq("id", orgId).single(),
      supabaseAdmin
        .from("users")
        .select("id, email, first_name, last_name")
        .in("id", [inviterId, memberId]),
    ]);
    if (orgError || !org || usersError || !users) {
      console.error(
        `Organization ${orgId}: failed to load member invitation email data`,
        orgError?.message ?? usersError?.message,
      );
      return false;
    }

    const rows = users as MemberInviteUserRow[];
    const member = rows.find((u) => u.id === memberId);
    const inviter = rows.find((u) => u.id === inviterId);
    if (!member?.email) {
      console.error(
        `Organization ${orgId}: no address to send the member invitation to`,
      );
      return false;
    }

    const inviterName =
      [inviter?.first_name, inviter?.last_name]
        .filter((part) => part && part.trim())
        .join(" ")
        .trim() || "A teammate";

    await sendMemberInvitationEmail(member.email, {
      recipientName: member.first_name?.trim() || "there",
      inviterName,
      organizationName: (org as { name: string }).name,
      orgId,
      role,
      acceptUrl,
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
