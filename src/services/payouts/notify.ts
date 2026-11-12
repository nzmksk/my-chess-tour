import { supabaseAdmin } from "@/services/supabase/admin";
import {
  type AdminPayoutAlert,
  sendAdminPayoutAlertEmail,
  sendBeneficiaryNominationEmail,
} from "@/services/email/email";
import {
  loadOrganizationRecipients,
  loadPlatformAdminRecipients,
  sendToAll,
} from "./recipients";

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

/**
 * Asks a nominated organization's payout managers to accept a tournament's
 * payout. Nothing is redirected until one of them does, so an organization that
 * never hears about it simply never receives the money.
 */
export async function notifyBeneficiaryNominated(
  tournamentId: string,
  nomineeOrgId: string,
): Promise<void> {
  try {
    const [tournamentRes, nomineeRes] = await Promise.all([
      supabaseAdmin
        .from("tournaments")
        .select("name, organizer:organizations!organization_id(name)")
        .eq("id", tournamentId)
        .single(),
      supabaseAdmin.from("organizations").select("name").eq("id", nomineeOrgId).single(),
    ]);
    const error = tournamentRes.error ?? nomineeRes.error;
    if (error || !tournamentRes.data || !nomineeRes.data) {
      console.error(
        `Tournament ${tournamentId}: failed to load nomination email data`,
        error?.message,
      );
      return;
    }
    const tournament = tournamentRes.data as unknown as {
      name: string | null;
      organizer: { name: string | null } | null;
    };
    const nominee = nomineeRes.data as { name: string | null };

    const recipients = await loadOrganizationRecipients([nomineeOrgId]);
    await sendToAll(
      recipients,
      (r) =>
        sendBeneficiaryNominationEmail(r.email, {
          recipientName: r.name,
          nomineeOrgId,
          nomineeName: nominee.name ?? "your organization",
          organizerName: tournament.organizer?.name ?? "An organization",
          tournamentName: tournament.name ?? "a tournament",
        }),
      `nomination email(s) for tournament ${tournamentId}`,
    );
  } catch (err) {
    console.error(
      `Tournament ${tournamentId}: nomination email failed`,
      err instanceof Error ? err.message : err,
    );
  }
}
