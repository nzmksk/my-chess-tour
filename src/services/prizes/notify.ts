import { supabaseAdmin } from "@/services/supabase/admin";
import {
  sendAdminPayoutAlertEmail,
  sendPrizeAwardedEmail,
  sendPrizePaidEmail,
} from "@/services/email/email";
import { sendToAll, type EmailRecipient } from "@/services/email/recipients";
import {
  canActInSettings,
  loadParticipantRecipients,
  nameForRecipient,
} from "@/services/email/participant-recipients";
import { loadPlatformAdminRecipients } from "@/services/payouts/recipients";
import { loadPrizePayees } from "./payee";

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
  bank: { account_number: string } | null;
}

async function loadAward(awardId: string): Promise<AwardEmailRow | null> {
  const { data, error } = await supabaseAdmin
    .from("prize_awards")
    .select(
      `id, category, place, amount_cents, settled_amount_cents, chip_receipt_url, user_id,
       tournament:tournaments(name),
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
    if (!award?.user_id) return;
    const contacts = await loadParticipantRecipients(award.user_id);
    if (!contacts) return;
    if (contacts.recipients.size === 0) {
      console.warn(`Prize award ${awardId}: nobody to email about the winner; not notified`);
      return;
    }

    const payees = await loadPrizePayees([award.user_id]);
    if (!payees.ok) {
      console.error(
        `Prize award ${awardId}: failed to work out whose account it is paid to`,
        payees.error.message,
      );
    }
    const payee = payees.ok ? payees.payees.get(award.user_id) : undefined;
    const payeeId = payee?.payeeId ?? award.user_id;
    let payeeEmail: string | null = null;
    if (payee?.reason === "guardian_of_minor") {
      const { data: payeeUser } = await supabaseAdmin
        .from("users")
        .select("email")
        .eq("id", payeeId)
        .maybeSingle();
      payeeEmail = (payeeUser as { email: string | null } | null)?.email ?? null;
    }
    const { data: bank } = await supabaseAdmin
      .from("player_bank_accounts")
      .select("account_number, status")
      .eq("user_id", payeeId)
      .eq("is_active", true)
      .maybeSingle();
    const account = bank as { account_number: string; status: string } | null;
    const rejected = accountRejected || account?.status === "rejected";

    await sendToAll(
      contacts.recipients,
      (r) =>
        sendPrizeAwardedEmail(r.email, {
          recipientName: r.name,
          tournamentName: award.tournament?.name ?? "your tournament",
          prizeName: prizeLabel(award.category, award.place),
          amountCents: award.amount_cents,
          accountLast4: rejected || !account ? null : account.account_number.slice(-4),
          accountRejected: rejected,
          aboutPlayer: nameForRecipient(contacts, r),
          canActInSettings: canActInSettings(contacts, r),
          paidToRecipientAsGuardian:
            payeeEmail !== null &&
            r.email.toLowerCase() === payeeEmail.toLowerCase(),
        }),
      `prize awarded email(s) for award ${awardId}`,
    );
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
    if (!award?.user_id) return;
    const contacts = await loadParticipantRecipients(award.user_id);
    if (!contacts) return;
    if (contacts.recipients.size === 0) {
      console.warn(`Prize award ${awardId}: nobody to email about the winner; not notified`);
      return;
    }
    await sendToAll(
      contacts.recipients,
      (r) =>
        sendPrizePaidEmail(r.email, {
          recipientName: r.name,
          tournamentName: award.tournament?.name ?? "your tournament",
          prizeName: prizeLabel(award.category, award.place),
          amountCents: award.settled_amount_cents ?? award.amount_cents,
          accountLast4: award.bank?.account_number.slice(-4) ?? "",
          receiptUrl: award.chip_receipt_url,
          aboutPlayer: nameForRecipient(contacts, r),
        }),
      `prize paid email(s) for award ${awardId}`,
    );
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
