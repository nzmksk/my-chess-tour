import { supabaseAdmin } from "@/services/supabase/admin";
import {
  type AdminPayoutAlert,
  sendAdminPayoutAlertEmail,
} from "@/services/email/email";
import { loadPlatformAdminRecipients, sendToAll } from "./recipients";

// Payout emails other than settlement (settle.ts). Each is best-effort and never
// throws: it runs after the action it reports on has committed.

interface AlertPayoutRow {
  id: string;
  kind: "automatic" | "early";
  amount_cents: number;
  reason: string | null;
  tournament: { name: string | null } | null;
  organizer: { name: string | null } | null;
}

/**
 * Tells every platform admin about a payout that needs a person: an early request
 * to review, or a payout parked until CHIP Send budget is approved. `detail` is
 * an extra line; an early request shows the organizer's reason instead.
 */
export async function notifyAdminsOfPayout(
  payoutId: string,
  alert: AdminPayoutAlert,
  detail?: string,
): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("payouts")
      .select(
        `id, kind, amount_cents, reason,
         tournament:tournaments(name),
         organizer:organizations!organization_id(name)`,
      )
      .eq("id", payoutId)
      .single();
    if (error || !data) {
      console.error(
        `Payout ${payoutId}: failed to load admin alert data`,
        error?.message,
      );
      return;
    }
    const payout = data as unknown as AlertPayoutRow;

    const recipients = await loadPlatformAdminRecipients();
    if (recipients.size === 0) {
      console.error(`Payout ${payoutId}: no platform admins to alert (${alert})`);
      return;
    }

    await sendToAll(
      recipients,
      (r) =>
        sendAdminPayoutAlertEmail(r.email, {
          alert,
          recipientName: r.name,
          tournamentName: payout.tournament?.name ?? "Unknown tournament",
          organizationName: payout.organizer?.name ?? "Unknown organization",
          amountCents: payout.amount_cents,
          detail:
            detail ??
            (alert === "early_request" && payout.reason
              ? `Reason given: ${payout.reason}`
              : undefined),
          path:
            alert === "early_request"
              ? `/admin/payouts/${payout.id}`
              : "/admin/payouts",
        }),
      `admin payout alert(s) for payout ${payoutId}`,
    );
  } catch (err) {
    console.error(
      `Payout ${payoutId}: admin alert failed`,
      err instanceof Error ? err.message : err,
    );
  }
}
