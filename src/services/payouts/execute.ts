import { supabaseAdmin } from "@/services/supabase/admin";
import {
  ChipSendError,
  chipSendAmountToCents,
  chipSendOutcome,
  createChipSendInstruction,
  getChipSendAccounts,
  getChipSendLimit,
  increaseChipSendLimit,
} from "@/services/chip/send";
import { MIN_PAYOUT_CENTS } from "./constants";
import { settlePayout } from "./settle";

// Sends one queued payout through CHIP Send. Shared by the admin trigger, the
// approve path (Phase 6) and the sweep (Phase 7). The money state lives in
// queue_payout and settle_payout; this is only the network half, because a network
// call can't run inside their transactions.
//
// Re-running is always safe. `reference` is our row id, so CHIP returns the existing
// instruction instead of paying twice, and settle_payout no-ops on a settled row.

/**
 * What happened, for the caller to report or count:
 *   sent             CHIP accepted it; the webhook will settle it.
 *   paid             CHIP completed it synchronously; settled.
 *   failed           terminal; a retry is a new row.
 *   awaiting_budget  not enough Send balance; left `pending`, budget requested.
 *   blocked          a cancellation or refund is in the way; left `pending`.
 *   skipped          nothing to do: settled, unapproved, in flight or missing.
 *   error            a transient failure; left `pending`, safe to re-run.
 */
export type ExecutePayoutResult =
  | "sent"
  | "paid"
  | "failed"
  | "awaiting_budget"
  | "blocked"
  | "skipped"
  | "error";

interface PayoutRow {
  id: string;
  tournament_id: string;
  amount_cents: number;
  approval: string;
  status: string;
  processed_at: string | null;
  chip_send_limit_id: number | null;
  tournament: { name: string | null } | null;
  recipient: { email: string | null } | null;
  bank: {
    is_active: boolean;
    status: string;
    chip_bank_account_id: number | null;
  } | null;
}

// CHIP error bodies can echo the submitted account number; keep long digit runs
// out of the logs and out of failure_reason, which organizers can read.
function redactDigits(text: string): string {
  return text.replace(/\d{6,}/g, "[redacted]");
}

function describeError(err: unknown): string {
  if (err instanceof ChipSendError) {
    return `CHIP Send ${err.status}: ${redactDigits(err.body)}`;
  }
  return err instanceof Error ? redactDigits(err.message) : String(err);
}

// A 4xx usually means CHIP refused this payout, which is terminal. These don't: a
// 401 is our credentials or clock, and a 408/429 is timing. None of them says
// anything about the payout, so failing it would email an organizer about a problem
// that is ours, and re-sending later is safe because `reference` dedupes.
function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

/**
 * Terminal failure with no transfer. Reports `error` rather than `failed` if the
 * write itself didn't land, since the row is then still `pending`.
 */
async function failPayout(
  payoutId: string,
  reason: string,
  chipSendInstructionId: number | null = null,
): Promise<ExecutePayoutResult> {
  const { error } = await settlePayout({
    payoutId,
    chipSendInstructionId,
    paid: false,
    failureReason: reason,
  });
  if (error) {
    console.error(`Payout ${payoutId}: settle_payout failed`, error.message);
    return "error";
  }
  return "failed";
}

/**
 * Parks a payout that the balance can't cover: requests budget, and leaves the row
 * `pending`. A payout must never block on an approver's inbox, and a budget hiccup
 * must never burn the row, so nothing here can fail it.
 *
 * An allocation emails every approver, so a re-run must not request another while
 * one is still waiting on them. Only an expired one is replaced, or one that was
 * approved and has since been spent.
 */
async function awaitBudget(
  payout: PayoutRow,
  amountCents: number,
): Promise<ExecutePayoutResult> {
  if (payout.chip_send_limit_id !== null) {
    try {
      const limit = await getChipSendLimit(payout.chip_send_limit_id);
      if (limit.status === "pending") return "awaiting_budget";
    } catch (err) {
      // Can't tell, so assume it is still live rather than email approvers again.
      console.error(
        `Payout ${payout.id}: could not read send limit ${payout.chip_send_limit_id}`,
        describeError(err),
      );
      return "awaiting_budget";
    }
  }

  try {
    const limit = await increaseChipSendLimit(amountCents);
    const { error } = await supabaseAdmin
      .from("payouts")
      .update({ chip_send_limit_id: limit.id })
      .eq("id", payout.id)
      .is("processed_at", null);
    if (error) {
      console.error(
        `Payout ${payout.id}: failed to persist send limit ${limit.id}`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `Payout ${payout.id}: could not request send budget`,
      describeError(err),
    );
  }

  return "awaiting_budget";
}

/**
 * Sends a queued payout. NEVER throws: it runs after the queueing transaction has
 * committed, like processCancellationRefund. Anything transient is logged and the
 * row stays `pending`, still reserving its money, until a re-run.
 */
export async function executePayout(
  payoutId: string,
): Promise<ExecutePayoutResult> {
  try {
    return await execute(payoutId);
  } catch (err) {
    console.error(
      `Payout ${payoutId}: unexpected error during execution`,
      describeError(err),
    );
    return "error";
  }
}

async function execute(payoutId: string): Promise<ExecutePayoutResult> {
  const { data, error } = await supabaseAdmin
    .from("payouts")
    .select(
      `id, tournament_id, amount_cents, approval, status, processed_at, chip_send_limit_id,
       tournament:tournaments(name),
       recipient:organizations!recipient_organization_id(email),
       bank:organization_bank_accounts!bank_account_id(is_active, status, chip_bank_account_id)`,
    )
    .eq("id", payoutId)
    .maybeSingle();

  if (error) {
    console.error(`Payout ${payoutId}: failed to load`, error.message);
    return "error";
  }

  const payout = data as unknown as PayoutRow | null;
  if (!payout) {
    console.warn(`Payout ${payoutId}: not found; not executed`);
    return "skipped";
  }

  // `processing` already has an instruction out. The stuck-payout reconciler owns
  // it from here (Phase 7), via GET rather than by re-sending.
  if (
    payout.processed_at ||
    payout.approval !== "approved" ||
    payout.status !== "pending"
  ) {
    return "skipped";
  }

  // Re-checked because a payout can wait days for budget. A cancelled tournament
  // will never pay, so that one is terminal; a pending cancellation or refund may
  // yet resolve, so those wait, with the money still reserved.
  const { data: blocked, error: blockError } = await supabaseAdmin.rpc(
    "tournament_payout_block_reason",
    { p_tournament_id: payout.tournament_id },
  );
  if (blockError) {
    console.error(`Payout ${payoutId}: failed to check blocks`, blockError.message);
    return "error";
  }
  if (blocked === "tournament_cancelled") {
    return failPayout(payoutId, "tournament_cancelled");
  }
  if (blocked) {
    console.info(`Payout ${payoutId}: blocked (${String(blocked)}); left pending`);
    return "blocked";
  }

  // A superseded account must not be paid: the organizer replaced it for a reason.
  // Failing the row lets the retry pick up the current one.
  const bank = payout.bank;
  if (
    !bank ||
    !bank.is_active ||
    bank.status !== "verified" ||
    bank.chip_bank_account_id === null
  ) {
    return failPayout(payoutId, "bank_account_not_verified");
  }

  // Never trust the amount snapshotted at request time: days may have passed and
  // refunds may have landed.
  const { data: available, error: availableError } = await supabaseAdmin.rpc(
    "available_payout_cents",
    { p_tournament_id: payout.tournament_id, p_exclude_payout_id: payoutId },
  );
  if (availableError || typeof available !== "number") {
    console.error(
      `Payout ${payoutId}: failed to read available balance`,
      availableError?.message,
    );
    return "error";
  }

  const amountCents = Math.min(payout.amount_cents, available);
  if (amountCents < MIN_PAYOUT_CENTS) {
    return failPayout(payoutId, "insufficient_available_balance");
  }

  // Recorded before the send, so nothing can settle or reserve the stale figure.
  if (amountCents !== payout.amount_cents) {
    const { error: clampError } = await supabaseAdmin
      .from("payouts")
      .update({ amount_cents: amountCents })
      .eq("id", payoutId)
      .is("processed_at", null);
    if (clampError) {
      console.error(`Payout ${payoutId}: failed to clamp amount`, clampError.message);
      return "error";
    }
  }

  const recipientEmail = payout.recipient?.email;
  if (!recipientEmail) {
    // CHIP requires an address. Fixable by the organization, so not terminal.
    console.error(`Payout ${payoutId}: recipient organization has no email; left pending`);
    return "error";
  }

  const accounts = await getChipSendAccounts();
  const account = accounts.results.find((a) => a.currency === "MYR");
  if (!account) {
    console.error(`Payout ${payoutId}: no MYR CHIP Send account; left pending`);
    return "error";
  }
  // current_balance is a JSON number in ringgit.
  if (Math.round(account.current_balance * 100) < amountCents) {
    return awaitBudget(payout, amountCents);
  }

  let instruction;
  try {
    instruction = await createChipSendInstruction({
      bank_account_id: bank.chip_bank_account_id,
      amountCents,
      description: `MY Chess Tour payout: ${payout.tournament?.name ?? "tournament"}`.slice(0, 140),
      email: recipientEmail,
      reference: payoutId,
      // CHIP emails its own authoritative receipt, and our email points at it.
      send_recipient_receipt: true,
    });
  } catch (err) {
    if (err instanceof ChipSendError) {
      if (err.insufficientBalance) return awaitBudget(payout, amountCents);
      if (!isRetryableStatus(err.status)) {
        return failPayout(payoutId, `chip_send_${err.status}: ${redactDigits(err.body)}`.slice(0, 500));
      }
    }
    console.error(`Payout ${payoutId}: CHIP send failed; left pending`, describeError(err));
    return "error";
  }

  // Guarded on processed_at: the webhook can beat this write, and `processing` must
  // not overwrite a settled row. A failure here isn't fatal, since the webhook
  // correlates on `reference` and a re-run gets the same instruction back.
  const { error: persistError } = await supabaseAdmin
    .from("payouts")
    .update({ chip_send_instruction_id: instruction.id, status: "processing" })
    .eq("id", payoutId)
    .is("processed_at", null);
  if (persistError) {
    console.error(
      `Payout ${payoutId}: failed to persist instruction ${instruction.id}`,
      persistError.message,
    );
  }

  const outcome = chipSendOutcome(instruction.state);
  if (outcome === "pending") return "sent";

  if (outcome === "failed") {
    return failPayout(payoutId, `send_instruction_${instruction.state}`, instruction.id);
  }

  const { error: settleError } = await settlePayout({
    payoutId,
    chipSendInstructionId: instruction.id,
    paid: true,
    // What CHIP says it sent. Not always ours: a duplicate reference returns the
    // original instruction, whatever amount it was created for.
    amountCents: chipSendAmountToCents(instruction.amount) ?? amountCents,
    receiptUrl: instruction.receipt_url,
  });
  if (settleError) {
    // The money has left, so this is not a retryable send. The webhook re-delivers,
    // and settle_payout will book it then.
    console.error(
      `Payout ${payoutId}: instruction ${instruction.id} completed but settle_payout failed`,
      settleError.message,
    );
    return "sent";
  }
  return "paid";
}
