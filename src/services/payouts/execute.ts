import { supabaseAdmin } from "@/services/supabase/admin";
import {
  ChipSendError,
  chipSendAmountToCents,
  chipSendOutcome,
  createChipSendInstruction,
  getChipSendAccounts,
  getChipSendLimit,
  increaseChipSendLimit,
  toChipSendDescription,
} from "@/services/chip/send";
import { CHIP_SEND_FEE_CENTS, MIN_PAYOUT_CENTS } from "./constants";
import {
  describeDbError,
  describeSendError as describeError,
  isRefusedBeforeSending,
  isRetryableStatus,
  redactDigits,
} from "./send-errors";
import { formatRinggit } from "./format";
import { notifyAdminsOfPayout } from "./notify";
import { settlePayout } from "./settle";
import { afterResponse } from "@/lib/http/after-response";

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
  recipient_organization_id: string;
  amount_cents: number;
  approval: string;
  status: string;
  processed_at: string | null;
  chip_send_instruction_id: number | null;
  chip_send_limit_id: number | null;
  tournament: { name: string | null } | null;
  recipient: { email: string | null } | null;
  bank: {
    is_active: boolean;
    status: string;
    chip_bank_account_id: number | null;
  } | null;
}

async function releaseClaim(payoutId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("payouts")
    .update({ status: "pending" })
    .eq("id", payoutId)
    .eq("status", "processing")
    .is("chip_send_instruction_id", null)
    .is("processed_at", null);
  if (error) {
    console.error(
      `Payout ${payoutId}: failed to release its send claim; left processing until a re-run`,
      describeDbError(error),
    );
  }
}

async function failPayout(
  payoutId: string,
  reason: string,
  { instructionId = null, detail }: { instructionId?: number | null; detail?: string } = {},
): Promise<ExecutePayoutResult> {
  const context = [
    instructionId !== null ? `instruction ${instructionId}` : null,
    detail,
  ]
    .filter(Boolean)
    .join("; ");
  console.error(
    `Payout ${payoutId}: failed (${reason})${context ? `; ${context}` : ""}`,
  );

  const { error } = await settlePayout({
    payoutId,
    chipSendInstructionId: instructionId,
    paid: false,
    failureReason: reason,
  });
  if (error) {
    console.error(
      `Payout ${payoutId}: settle_payout failed while marking it failed; left pending`,
      describeDbError(error),
    );
    return "error";
  }
  return "failed";
}

async function awaitBudget(
  payout: PayoutRow,
  amountCents: number,
): Promise<ExecutePayoutResult> {
  if (payout.chip_send_limit_id !== null) {
    try {
      const limit = await getChipSendLimit(payout.chip_send_limit_id);
      if (limit.status === "pending") {
        console.warn(
          `Payout ${payout.id}: send limit ${limit.id} is still waiting for approval; left pending`,
        );
        return "awaiting_budget";
      }
      console.info(
        `Payout ${payout.id}: send limit ${limit.id} is ${limit.status}${limit.expiry_reason ? ` (${limit.expiry_reason})` : ""}; requesting a new one`,
      );
    } catch (err) {
      console.error(
        `Payout ${payout.id}: could not read send limit ${payout.chip_send_limit_id}`,
        describeError(err),
      );
      return "awaiting_budget";
    }
  }

  const requestCents = amountCents + CHIP_SEND_FEE_CENTS;
  try {
    const limit = await increaseChipSendLimit(requestCents);
    const { error } = await supabaseAdmin
      .from("payouts")
      .update({ chip_send_limit_id: limit.id })
      .eq("id", payout.id)
      .is("processed_at", null);
    if (error) {
      console.error(
        `Payout ${payout.id}: failed to persist send limit ${limit.id}`,
        describeDbError(error),
      );
    }
    console.warn(
      `Payout ${payout.id}: requested send limit ${limit.id} for ${requestCents} cents (${amountCents} payout + ${CHIP_SEND_FEE_CENTS} fee); left pending until it is approved`,
    );
    afterResponse(() =>
      notifyAdminsOfPayout(
        payout.id,
        "awaiting_budget",
        `A CHIP Send budget increase of ${formatRinggit(requestCents)} (payout plus the ${formatRinggit(CHIP_SEND_FEE_CENTS)} transfer fee) is waiting for an approver.`,
      ),
    );
  } catch (err) {
    console.error(
      `Payout ${payout.id}: could not request send budget`,
      describeError(err),
    );
  }

  return "awaiting_budget";
}

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
      `id, tournament_id, recipient_organization_id, amount_cents, approval, status, processed_at, chip_send_instruction_id, chip_send_limit_id,
       tournament:tournaments(name),
       recipient:organizations!recipient_organization_id(email),
       bank:organization_bank_accounts!bank_account_id(is_active, status, chip_bank_account_id)`,
    )
    .eq("id", payoutId)
    .maybeSingle();

  if (error) {
    console.error(`Payout ${payoutId}: failed to load`, describeDbError(error));
    return "error";
  }

  const payout = data as unknown as PayoutRow | null;
  if (!payout) {
    console.warn(`Payout ${payoutId}: not found; not executed`);
    return "skipped";
  }

  const claimed =
    payout.status === "processing" && payout.chip_send_instruction_id === null;
  if (
    payout.processed_at ||
    payout.approval !== "approved" ||
    (payout.status !== "pending" && !claimed)
  ) {
    console.info(
      `Payout ${payoutId}: skipped (status ${payout.status}, approval ${payout.approval}${payout.processed_at ? ", already settled" : ""})`,
    );
    return "skipped";
  }

  if (claimed) {
    const chipBankAccountId = payout.bank?.chip_bank_account_id;
    const recipientEmail = payout.recipient?.email;
    if (!chipBankAccountId || !recipientEmail) {
      console.error(
        `Payout ${payoutId}: claimed for sending but its bank account or email is gone; left processing`,
      );
      return "error";
    }
    console.info(`Payout ${payoutId}: resuming an earlier send`);
    return send(payout, chipBankAccountId, recipientEmail, payout.amount_cents);
  }

  const { data: blocked, error: blockError } = await supabaseAdmin.rpc(
    "tournament_payout_block_reason",
    { p_tournament_id: payout.tournament_id },
  );
  if (blockError) {
    console.error(`Payout ${payoutId}: failed to check blocks`, describeDbError(blockError));
    return "error";
  }
  if (blocked === "tournament_cancelled") {
    return failPayout(payoutId, "tournament_cancelled");
  }
  if (blocked) {
    console.info(`Payout ${payoutId}: blocked (${String(blocked)}); left pending`);
    return "blocked";
  }

  const { data: problem, error: problemError } = await supabaseAdmin.rpc(
    "payout_recipient_problem",
    { p_org_id: payout.recipient_organization_id },
  );
  if (problemError) {
    console.error(
      `Payout ${payoutId}: failed to check the recipient`,
      describeDbError(problemError),
    );
    return "error";
  }
  if (problem && problem !== "bank_account_not_verified") {
    console.info(
      `Payout ${payoutId}: recipient ${payout.recipient_organization_id} cannot be paid (${String(problem)}); left pending`,
    );
    return "blocked";
  }

  const bank = payout.bank;
  if (
    !bank ||
    !bank.is_active ||
    bank.status !== "verified" ||
    bank.chip_bank_account_id === null
  ) {
    return failPayout(payoutId, "bank_account_not_verified", {
      detail: !bank
        ? "no bank account on the payout"
        : `bank account active=${bank.is_active}, status=${bank.status}, chip id ${bank.chip_bank_account_id ?? "none"}`,
    });
  }

  const { data: available, error: availableError } = await supabaseAdmin.rpc(
    "available_payout_cents",
    { p_tournament_id: payout.tournament_id, p_exclude_payout_id: payoutId },
  );
  if (availableError || typeof available !== "number") {
    console.error(
      `Payout ${payoutId}: failed to read available balance`,
      availableError ? describeDbError(availableError) : `got ${String(available)}`,
    );
    return "error";
  }

  const amountCents = Math.min(payout.amount_cents, available);
  if (amountCents < MIN_PAYOUT_CENTS) {
    return failPayout(payoutId, "insufficient_available_balance", {
      detail: `requested ${payout.amount_cents} cents, ${available} available, minimum ${MIN_PAYOUT_CENTS}`,
    });
  }

  if (amountCents !== payout.amount_cents) {
    console.info(
      `Payout ${payoutId}: amount reduced from ${payout.amount_cents} to ${amountCents} cents to fit what is available`,
    );
    const { error: clampError } = await supabaseAdmin
      .from("payouts")
      .update({ amount_cents: amountCents })
      .eq("id", payoutId)
      .is("processed_at", null);
    if (clampError) {
      console.error(`Payout ${payoutId}: failed to clamp amount`, describeDbError(clampError));
      return "error";
    }
  }

  const recipientEmail = payout.recipient?.email;
  if (!recipientEmail) {
    console.error(`Payout ${payoutId}: recipient organization has no email; left pending`);
    return "error";
  }

  let accounts;
  try {
    accounts = await getChipSendAccounts();
  } catch (err) {
    console.error(
      `Payout ${payoutId}: could not read the CHIP Send balance; left pending`,
      describeError(err),
    );
    return "error";
  }
  const account = accounts.results.find((a) => a.currency === "MYR");
  if (!account) {
    console.error(`Payout ${payoutId}: no MYR CHIP Send account; left pending`);
    return "error";
  }
  const balanceCents = Math.round(account.current_balance * 100);
  const neededCents = amountCents + CHIP_SEND_FEE_CENTS;
  if (balanceCents < neededCents) {
    console.warn(
      `Payout ${payoutId}: CHIP Send balance ${balanceCents} cents is below the ${amountCents} cents payout plus ${CHIP_SEND_FEE_CENTS} cents fee`,
    );
    return awaitBudget(payout, amountCents);
  }

  const { data: claimRefusal, error: claimError } = await supabaseAdmin.rpc(
    "claim_payout_send",
    { p_payout_id: payoutId },
  );
  if (claimError) {
    console.error(`Payout ${payoutId}: failed to claim for sending`, describeDbError(claimError));
    return "error";
  }
  if (claimRefusal === "tournament_cancelled") {
    return failPayout(payoutId, "tournament_cancelled");
  }
  if (claimRefusal === "not_claimable") {
    console.info(`Payout ${payoutId}: skipped (another run claimed or settled it first)`);
    return "skipped";
  }
  if (claimRefusal) {
    console.info(`Payout ${payoutId}: blocked (${String(claimRefusal)}) at claim; left pending`);
    return "blocked";
  }

  return send(payout, bank.chip_bank_account_id, recipientEmail, amountCents);
}

async function send(
  payout: PayoutRow,
  chipBankAccountId: number,
  recipientEmail: string,
  amountCents: number,
): Promise<ExecutePayoutResult> {
  const payoutId = payout.id;
  let instruction;
  try {
    instruction = await createChipSendInstruction({
      bank_account_id: chipBankAccountId,
      amountCents,
      description: toChipSendDescription(
        `MY Chess Tour - ${payout.tournament?.name ?? "tournament payout"}`,
      ),
      email: recipientEmail,
      reference: payoutId,
      send_recipient_receipt: true,
    });
  } catch (err) {
    if (err instanceof ChipSendError) {
      if (err.insufficientBalance) {
        console.warn(
          `Payout ${payoutId}: CHIP refused the send for insufficient balance`,
          describeError(err),
        );
        await releaseClaim(payoutId);
        return awaitBudget(payout, amountCents);
      }
      if (!isRetryableStatus(err.status)) {
        return failPayout(
          payoutId,
          `chip_send_${err.status}: ${redactDigits(err.body)}`.slice(0, 500),
        );
      }
      if (isRefusedBeforeSending(err.status)) {
        console.error(`Payout ${payoutId}: CHIP refused the send; left pending`, describeError(err));
        await releaseClaim(payoutId);
        return "error";
      }
    }
    console.error(
      `Payout ${payoutId}: CHIP send may not have gone through; left processing until a re-run confirms it`,
      describeError(err),
    );
    return "error";
  }

  const { error: persistError } = await supabaseAdmin
    .from("payouts")
    .update({ chip_send_instruction_id: instruction.id, status: "processing" })
    .eq("id", payoutId)
    .is("processed_at", null);
  if (persistError) {
    console.error(
      `Payout ${payoutId}: failed to persist instruction ${instruction.id}`,
      describeDbError(persistError),
    );
  }

  const outcome = chipSendOutcome(instruction.state);
  if (outcome === "pending") {
    console.info(
      `Payout ${payoutId}: sent as instruction ${instruction.id} (state ${instruction.state}); waiting for the webhook`,
    );
    return "sent";
  }

  if (outcome === "failed") {
    return failPayout(payoutId, `send_instruction_${instruction.state}`, {
      instructionId: instruction.id,
    });
  }

  const { error: settleError } = await settlePayout({
    payoutId,
    chipSendInstructionId: instruction.id,
    paid: true,
    amountCents: chipSendAmountToCents(instruction.amount) ?? amountCents,
    receiptUrl: instruction.receipt_url,
  });
  if (settleError) {
    console.error(
      `Payout ${payoutId}: instruction ${instruction.id} completed but settle_payout failed`,
      describeDbError(settleError),
    );
    return "sent";
  }
  console.info(`Payout ${payoutId}: paid as instruction ${instruction.id}`);
  return "paid";
}
