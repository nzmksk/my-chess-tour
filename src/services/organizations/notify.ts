import { supabaseAdmin } from "@/services/supabase/admin";
import { sendOrganizerApplicationReviewEmail } from "@/services/email/email";
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
