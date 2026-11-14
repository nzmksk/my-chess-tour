import { supabaseAdmin } from "@/services/supabase/admin";
import {
  sendPayoutFailedEmail,
  sendPayoutProcessedEmail,
} from "@/services/email/email";
import { describePayoutFailure } from "./failure-reason";
import { loadOrganizationRecipients, sendToAll } from "./recipients";

// Settlement is reached from two paths that must agree: the synchronous response
// in executePayout, and the CHIP Send webhook. Both come through settlePayout, so
// whichever arrives first books the ledger row and sends the email, and the other
// is a no-op (settle_payout's processed_at check).

export interface SettlePayoutInput {
  payoutId: string;
  chipSendInstructionId: number | null;
  paid: boolean;
  amountCents?: number | null;
  receiptUrl?: string | null;
  failureReason?: string | null;
}

export interface SettlePayoutResult {
  /** Set when the RPC failed; the caller decides whether that is retryable. */
  error: { code?: string; message: string } | null;
  /** True when this call changed the row (false for a no-op repeat). */
  settled: boolean;
}

interface SettlePayoutRpcResult {
  already_processed: boolean;
  over_payout?: boolean;
  paid_after_failed?: boolean;
}

/**
 * Settles a payout via settle_payout and, when this call is the one that changed
 * the row, emails both sides of it. The email is best-effort: only the RPC outcome
 * is reported back.
 *
 * Money discrepancies are logged at error level: an over-payout, or CHIP reporting
 * a transfer complete on a row already written off. Both need a person to look.
 */
export async function settlePayout(
  input: SettlePayoutInput,
): Promise<SettlePayoutResult> {
  const { data, error } = await supabaseAdmin.rpc("settle_payout", {
    p_payout_id: input.payoutId,
    p_chip_send_instruction_id: input.chipSendInstructionId,
    p_paid: input.paid,
    p_amount_cents: input.amountCents ?? null,
    p_receipt_url: input.receiptUrl ?? null,
    p_failure_reason: input.failureReason ?? null,
  });

  if (error) {
    return { error: { code: error.code, message: error.message }, settled: false };
  }

  const result = data as SettlePayoutRpcResult;

  if (result.paid_after_failed) {
    console.error(
      `Payout ${input.payoutId}: CHIP reports the transfer complete, but the payout was already marked failed. Money may have left with no ledger row.`,
    );
  }
  if (result.already_processed) {
    console.info(`Payout ${input.payoutId}: already settled; nothing to do`);
    return { error: null, settled: false };
  }

  console.info(
    `Payout ${input.payoutId}: settled as ${input.paid ? "paid" : "failed"}${
      input.chipSendInstructionId !== null ? ` (instruction ${input.chipSendInstructionId})` : ""
    }`,
  );

  if (result.over_payout) {
    console.error(
      `Payout ${input.payoutId}: settled for more than was available. Booked anyway because the money has left; this tournament may now be overpaid.`,
    );
  }

  try {
    await notifyPayoutSettled(input.payoutId);
  } catch (err) {
    console.error(
      `Payout ${input.payoutId}: settlement email failed`,
      err instanceof Error ? err.message : err,
    );
  }

  return { error: null, settled: true };
}

interface PayoutEmailRow {
  id: string;
  kind: "automatic" | "early";
  status: string;
  amount_cents: number;
  settled_amount_cents: number | null;
  failure_reason: string | null;
  chip_receipt_url: string | null;
  organization_id: string;
  recipient_organization_id: string;
  tournament: { name: string | null } | null;
  bank: { account_number: string } | null;
}

/**
 * Emails the outcome to the recipient org and, when a beneficiary was paid, the
 * organizing org too: it stays liable for that money, so it should hear about it.
 * Failures are logged, never thrown past settlePayout.
 */
async function notifyPayoutSettled(payoutId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("payouts")
    .select(
      `id, kind, status, amount_cents, settled_amount_cents, failure_reason,
       chip_receipt_url, organization_id, recipient_organization_id,
       tournament:tournaments(name),
       bank:organization_bank_accounts!bank_account_id(account_number)`,
    )
    .eq("id", payoutId)
    .single();

  if (error || !data) {
    console.error(
      `Payout ${payoutId}: failed to load settlement email data`,
      error?.message,
    );
    return;
  }

  const payout = data as unknown as PayoutEmailRow;
  const recipients = await loadOrganizationRecipients([
    ...new Set([payout.organization_id, payout.recipient_organization_id]),
  ]);

  const tournamentName = payout.tournament?.name ?? "your tournament";
  const paid = payout.status === "paid";
  // Last 4 only: the full number never leaves this function.
  const accountLast4 = payout.bank?.account_number.slice(-4) ?? "";

  await sendToAll(
    recipients,
    (r) =>
      paid
        ? sendPayoutProcessedEmail(r.email, {
            recipientName: r.name,
            tournamentName,
            amountCents: payout.settled_amount_cents ?? payout.amount_cents,
            accountLast4,
            receiptUrl: payout.chip_receipt_url,
            early: payout.kind === "early",
          })
        : sendPayoutFailedEmail(r.email, {
            recipientName: r.name,
            tournamentName,
            amountCents: payout.amount_cents,
            failureReason: describePayoutFailure(payout.failure_reason),
          }),
    `payout email(s) for payout ${payoutId}`,
  );
}
