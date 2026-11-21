import { supabaseAdmin } from "@/services/supabase/admin";
import {
  sendAdminPayoutAlertEmail,
  sendPrizeAwardedEmail,
  sendPrizePaidEmail,
} from "@/services/email/email";
import { sendToAll, type EmailRecipient } from "@/services/email/recipients";
import { loadPlatformAdminRecipients } from "@/services/payouts/recipients";

export function prizeLabel(category: string, place: string | null): string {
  return place ? `${category} — ${place}` : category;
}

interface AwardEmailRow {
  id: string;
  category: string;
  place: string | null;
  amount_cents: number;
  settled_amount_cents: number | null;
  chip_receipt_url: string | null;
  user_id: string | null;
  tournament: { name: string | null } | null;
  winner: { email: string | null; first_name: string | null } | null;
  bank: { account_number: string } | null;
}

async function loadAward(awardId: string): Promise<AwardEmailRow | null> {
  const { data, error } = await supabaseAdmin
    .from("prize_awards")
    .select(
      `id, category, place, amount_cents, settled_amount_cents, chip_receipt_url, user_id,
       tournament:tournaments(name),
       winner:users!user_id(email, first_name),
       bank:player_bank_accounts!bank_account_id(account_number)`,
    )
    .eq("id", awardId)
    .maybeSingle();
  if (error || !data) {
    console.error(`Prize award ${awardId}: failed to load email data`, error?.message);
    return null;
  }
  return data as unknown as AwardEmailRow;
}

export async function notifyPrizeAwarded(
  awardId: string,
  { accountRejected = false }: { accountRejected?: boolean } = {},
): Promise<void> {
  try {
    const award = await loadAward(awardId);
    if (!award) return;
    const email = award.winner?.email;
    if (!email || !award.user_id) {
      console.warn(`Prize award ${awardId}: the winner has no email; not notified`);
      return;
    }

    const { data: bank } = await supabaseAdmin
      .from("player_bank_accounts")
      .select("account_number, status")
      .eq("user_id", award.user_id)
      .eq("is_active", true)
      .maybeSingle();
    const account = bank as { account_number: string; status: string } | null;
    const rejected = accountRejected || account?.status === "rejected";

    await sendPrizeAwardedEmail(email, {
      recipientName: award.winner?.first_name ?? "there",
      tournamentName: award.tournament?.name ?? "your tournament",
      prizeName: prizeLabel(award.category, award.place),
      amountCents: award.amount_cents,
      accountLast4: rejected || !account ? null : account.account_number.slice(-4),
      accountRejected: rejected,
    });
  } catch (err) {
    console.error(
      `Prize award ${awardId}: awarded email failed`,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function notifyPrizePaid(awardId: string): Promise<void> {
  try {
    const award = await loadAward(awardId);
    if (!award) return;
    const email = award.winner?.email;
    if (!email) {
      console.warn(`Prize award ${awardId}: the winner has no email; not notified`);
      return;
    }
    await sendPrizePaidEmail(email, {
      recipientName: award.winner?.first_name ?? "there",
      tournamentName: award.tournament?.name ?? "your tournament",
      prizeName: prizeLabel(award.category, award.place),
      amountCents: award.settled_amount_cents ?? award.amount_cents,
      accountLast4: award.bank?.account_number.slice(-4) ?? "",
      receiptUrl: award.chip_receipt_url,
    });
  } catch (err) {
    console.error(
      `Prize award ${awardId}: paid email failed`,
      err instanceof Error ? err.message : err,
    );
  }
}

interface TournamentAlertRow {
  name: string | null;
  organizer: { name: string | null } | null;
}

export async function notifyAdminsOfPrizes(
  tournamentId: string,
  alert: "prize_review" | "awaiting_budget",
  amountCents: number,
  detail?: string,
): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("tournaments")
      .select("name, organizer:organizations!organization_id(name)")
      .eq("id", tournamentId)
      .maybeSingle();
    if (error || !data) {
      console.error(
        `Tournament ${tournamentId}: failed to load prize alert data`,
        error?.message,
      );
      return;
    }
    const tournament = data as unknown as TournamentAlertRow;

    const recipients: Map<string, EmailRecipient> = await loadPlatformAdminRecipients();
    if (recipients.size === 0) {
      console.error(`Tournament ${tournamentId}: no platform admins to alert (${alert})`);
      return;
    }

    await sendToAll(
      recipients,
      (r) =>
        sendAdminPayoutAlertEmail(r.email, {
          alert,
          recipientName: r.name,
          tournamentName: tournament.name ?? "Unknown tournament",
          organizationName: tournament.organizer?.name ?? "Unknown organization",
          amountCents,
          detail,
          path: "/admin/prizes",
        }),
      `admin prize alert(s) for tournament ${tournamentId}`,
    );
  } catch (err) {
    console.error(
      `Tournament ${tournamentId}: admin prize alert failed`,
      err instanceof Error ? err.message : err,
    );
  }
}
