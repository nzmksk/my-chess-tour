import { supabaseAdmin } from "@/services/supabase/admin";
import { sendOkuReviewEmail } from "@/services/email/email";

interface ReviewedOkuRow {
  oku_status: "none" | "pending" | "verified" | "rejected";
  oku_rejection_reason: string | null;
  user: { email: string | null; first_name: string | null } | null;
}

/**
 * Tells a player the outcome of their OKU card review. Best-effort and never
 * throws: it runs after the review has been saved, and reads the outcome back
 * from the profile rather than trusting the caller.
 */
export async function notifyOkuReviewed(userId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("player_profiles")
      .select("oku_status, oku_rejection_reason, user:users!user_id(email, first_name)")
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
    const email = profile.user?.email;
    if (!email) {
      console.error(`User ${userId}: no address to send the OKU review email to`);
      return;
    }

    await sendOkuReviewEmail(email, {
      recipientName: profile.user?.first_name ?? "there",
      verified: profile.oku_status === "verified",
      rejectionReason: profile.oku_rejection_reason ?? undefined,
    });
  } catch (err) {
    console.error(
      `User ${userId}: OKU review email failed`,
      err instanceof Error ? err.message : err,
    );
  }
}
