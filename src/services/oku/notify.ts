import { supabaseAdmin } from "@/services/supabase/admin";
import { sendOkuReviewEmail } from "@/services/email/email";
import { sendToAll } from "@/services/email/recipients";
import {
  loadParticipantRecipients,
  nameForRecipient,
} from "@/services/email/participant-recipients";

interface ReviewedOkuRow {
  oku_status: "none" | "pending" | "verified" | "rejected";
  oku_rejection_reason: string | null;
}

export async function notifyOkuReviewed(userId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("player_profiles")
      .select("oku_status, oku_rejection_reason")
      .eq("user_id", userId)
      .single();
    if (error || !data) {
      console.error(
        `User ${userId}: failed to load OKU review email data`,
        error?.message,
      );
      return;
    }
    const profile = data as unknown as ReviewedOkuRow;
    if (profile.oku_status !== "verified" && profile.oku_status !== "rejected") {
      console.error(
        `User ${userId}: OKU review email requested for status ${profile.oku_status}`,
      );
      return;
    }
    const contacts = await loadParticipantRecipients(userId);
    if (!contacts) return;
    if (contacts.recipients.size === 0) {
      console.error(`User ${userId}: no address to send the OKU review email to`);
      return;
    }

    await sendToAll(
      contacts.recipients,
      (r) =>
        sendOkuReviewEmail(r.email, {
          recipientName: r.name,
          verified: profile.oku_status === "verified",
          rejectionReason: profile.oku_rejection_reason ?? undefined,
          aboutPlayer: nameForRecipient(contacts, r),
        }),
      `OKU review email(s) for user ${userId}`,
    );
  } catch (err) {
    console.error(
      `User ${userId}: OKU review email failed`,
      err instanceof Error ? err.message : err,
    );
  }
}
