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
import { registerPlayerBankAccount } from "@/services/payouts/bank-account";
import { CHIP_SEND_FEE_CENTS, PAYOUT_CONCURRENCY } from "@/services/payouts/constants";
import { formatRinggit } from "@/services/payouts/format";
import type { ExecutePayoutResult } from "@/services/payouts/execute";
import {
  describeDbError,
  describeSendError as describeError,
  isRefusedBeforeSending,
  isRetryableStatus,
  redactDigits,
} from "@/services/payouts/send-errors";
import { afterResponse } from "@/lib/http/after-response";
import { notifyAdminsOfPrizes, notifyPrizeAwarded } from "./notify";
import { settlePrizeAward } from "./settle";

export type ExecutePrizeAwardResult = ExecutePayoutResult;

interface AwardRow {
  id: string;
  tournament_id: string;
  user_id: string | null;
  category: string;
  amount_cents: number;
  approval: string;
  status: string;
  processed_at: string | null;
  chip_send_instruction_id: number | null;
  chip_send_limit_id: number | null;
  tournament: { name: string | null } | null;
  winner: { email: string | null } | null;
  bank: { chip_bank_account_id: number | null } | null;
}

const AWARD_COLUMNS = `id, tournament_id, user_id, category, amount_cents, approval, status, processed_at,
  chip_send_instruction_id, chip_send_limit_id,
  tournament:tournaments(name),
  winner:users!user_id(email),
  bank:player_bank_accounts!bank_account_id(chip_bank_account_id)`;

async function loadAward(
  awardId: string,
): Promise<{ award: AwardRow | null } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from("prize_awards")
    .select(AWARD_COLUMNS)
    .eq("id", awardId)
    .maybeSingle();
  if (error) return { error: describeDbError(error) };
  return { award: data as unknown as AwardRow | null };
}

async function releaseClaim(awardId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("prize_awards")
    .update({ status: "pending" })
    .eq("id", awardId)
    .eq("status", "processing")
    .is("chip_send_instruction_id", null)
    .is("processed_at", null);
  if (error) {
    console.error(
      `Prize award ${awardId}: failed to release its send claim; left processing until a re-run`,
      describeDbError(error),
    );
  }
}

async function failAward(
  awardId: string,
  reason: string,
  { instructionId = null, detail }: { instructionId?: number | null; detail?: string } = {},
): Promise<ExecutePrizeAwardResult> {
  console.error(
    `Prize award ${awardId}: failed (${reason})${instructionId !== null ? `; instruction ${instructionId}` : ""}${detail ? `; ${detail}` : ""}`,
  );
  const { error } = await settlePrizeAward({
    awardId,
    chipSendInstructionId: instructionId,
    paid: false,
    failureReason: reason,
  });
  if (error) {
    console.error(
      `Prize award ${awardId}: settle_prize_award failed while marking it failed; left pending`,
      describeDbError(error),
    );
    return "error";
  }
  return "failed";
}

async function awaitBudget(
  award: AwardRow,
  amountCents: number,
): Promise<ExecutePrizeAwardResult> {
  if (award.chip_send_limit_id !== null) {
    try {
      const limit = await getChipSendLimit(award.chip_send_limit_id);
      if (limit.status === "pending") {
        console.warn(
          `Prize award ${award.id}: send limit ${limit.id} is still waiting for approval; left pending`,
        );
        return "awaiting_budget";
      }
    } catch (err) {
      console.error(
        `Prize award ${award.id}: could not read send limit ${award.chip_send_limit_id}`,
        describeError(err),
      );
      return "awaiting_budget";
    }
  }

  const requestCents = amountCents + CHIP_SEND_FEE_CENTS;
  try {
    const limit = await increaseChipSendLimit(requestCents);
    const { error } = await supabaseAdmin
      .from("prize_awards")
      .update({ chip_send_limit_id: limit.id })
      .eq("id", award.id)
      .is("processed_at", null);
    if (error) {
      console.error(
        `Prize award ${award.id}: failed to persist send limit ${limit.id}`,
        describeDbError(error),
      );
    }
    console.warn(
      `Prize award ${award.id}: requested send limit ${limit.id} for ${requestCents} cents; left pending until it is approved`,
    );
    afterResponse(() =>
      notifyAdminsOfPrizes(
        award.tournament_id,
        "awaiting_budget",
        amountCents,
        `A prize could not be sent: a CHIP Send budget increase of ${formatRinggit(requestCents)} (prize plus the ${formatRinggit(CHIP_SEND_FEE_CENTS)} transfer fee) is waiting for an approver.`,
      ),
    );
  } catch (err) {
    console.error(`Prize award ${award.id}: could not request send budget`, describeError(err));
  }
  return "awaiting_budget";
}

async function ensureWinnerAccount(award: AwardRow): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("player_bank_accounts")
    .select("id, status, chip_bank_account_id")
    .eq("user_id", award.user_id!)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return `could not load the winner's bank account (${describeDbError(error)})`;

  const bank = data as { id: string; status: string; chip_bank_account_id: number | null } | null;
  if (!bank) return "the winner has no bank account";
  if (bank.status === "verified" && bank.chip_bank_account_id !== null) return null;
  if (bank.status === "rejected") return "the winner's bank account could not be verified";

  const outcome = await registerPlayerBankAccount(bank.id);
  return outcome === "verified" ? null : `the winner's bank account is ${outcome === "rejected" ? "rejected" : "awaiting verification"}`;
}

export async function executePrizeAward(awardId: string): Promise<ExecutePrizeAwardResult> {
  try {
    return await execute(awardId);
  } catch (err) {
    console.error(`Prize award ${awardId}: unexpected error during execution`, describeError(err));
    return "error";
  }
}

async function execute(awardId: string): Promise<ExecutePrizeAwardResult> {
  const loaded = await loadAward(awardId);
  if ("error" in loaded) {
    console.error(`Prize award ${awardId}: failed to load`, loaded.error);
    return "error";
  }
  const award = loaded.award;
  if (!award) {
    console.warn(`Prize award ${awardId}: not found; not executed`);
    return "skipped";
  }

  const claimed = award.status === "processing" && award.chip_send_instruction_id === null;
  if (
    award.processed_at ||
    award.approval !== "approved" ||
    (award.status !== "pending" && !claimed)
  ) {
    console.info(
      `Prize award ${awardId}: skipped (status ${award.status}, approval ${award.approval}${award.processed_at ? ", already settled" : ""})`,
    );
    return "skipped";
  }

  if (claimed) {
    const chipBankAccountId = award.bank?.chip_bank_account_id;
    const email = award.winner?.email;
    if (!chipBankAccountId || !email) {
      console.error(
        `Prize award ${awardId}: claimed for sending but its bank account or email is gone; left processing`,
      );
      return "error";
    }
    console.info(`Prize award ${awardId}: resuming an earlier send`);
    return send(award, chipBankAccountId, email);
  }

  if (!award.user_id) {
    console.warn(`Prize award ${awardId}: the winner's account was deleted; left pending`);
    return "blocked";
  }
  const email = award.winner?.email;
  if (!email) {
    console.error(`Prize award ${awardId}: the winner has no email; left pending`);
    return "error";
  }

  const accountProblem = await ensureWinnerAccount(award);
  if (accountProblem) {
    console.info(`Prize award ${awardId}: waiting, ${accountProblem}`);
    return "blocked";
  }

  let accounts;
  try {
    accounts = await getChipSendAccounts();
  } catch (err) {
    console.error(`Prize award ${awardId}: could not read the CHIP Send balance; left pending`, describeError(err));
    return "error";
  }
  const account = accounts.results.find((a) => a.currency === "MYR");
  if (!account) {
    console.error(`Prize award ${awardId}: no MYR CHIP Send account; left pending`);
    return "error";
  }
  const balanceCents = Math.round(account.current_balance * 100);
  if (balanceCents < award.amount_cents + CHIP_SEND_FEE_CENTS) {
    console.warn(
      `Prize award ${awardId}: CHIP Send balance ${balanceCents} cents is below the ${award.amount_cents} cents prize plus ${CHIP_SEND_FEE_CENTS} cents fee`,
    );
    return awaitBudget(award, award.amount_cents);
  }

  const { data: refusal, error: claimError } = await supabaseAdmin.rpc(
    "claim_prize_award_send",
    { p_award_id: awardId },
  );
  if (claimError) {
    console.error(`Prize award ${awardId}: failed to claim for sending`, describeDbError(claimError));
    return "error";
  }
  if (refusal === "tournament_cancelled") return failAward(awardId, "tournament_cancelled");
  if (refusal === "not_claimable") {
    console.info(`Prize award ${awardId}: skipped (another run claimed or settled it first)`);
    return "skipped";
  }
  if (refusal) {
    console.info(`Prize award ${awardId}: blocked (${String(refusal)}) at claim; left pending`);
    return "blocked";
  }

  const reloaded = await loadAward(awardId);
  const chipBankAccountId =
    "award" in reloaded ? reloaded.award?.bank?.chip_bank_account_id : null;
  if (!chipBankAccountId) {
    console.error(`Prize award ${awardId}: claimed, but its bank account couldn't be read back; left processing`);
    return "error";
  }
  return send(award, chipBankAccountId, email);
}

async function send(
  award: AwardRow,
  chipBankAccountId: number,
  email: string,
): Promise<ExecutePrizeAwardResult> {
  const awardId = award.id;
  let instruction;
  try {
    instruction = await createChipSendInstruction({
      bank_account_id: chipBankAccountId,
      amountCents: award.amount_cents,
      description: toChipSendDescription(
        `MY Chess Tour prize - ${award.tournament?.name ?? "tournament"}`,
        "Prize",
      ),
      email,
      reference: awardId,
      send_recipient_receipt: true,
    });
  } catch (err) {
    if (err instanceof ChipSendError) {
      if (err.insufficientBalance) {
        console.warn(`Prize award ${awardId}: CHIP refused the send for insufficient balance`, describeError(err));
        await releaseClaim(awardId);
        return awaitBudget(award, award.amount_cents);
      }
      if (!isRetryableStatus(err.status)) {
        return failAward(awardId, `chip_send_${err.status}: ${redactDigits(err.body)}`.slice(0, 500));
      }
      if (isRefusedBeforeSending(err.status)) {
        console.error(`Prize award ${awardId}: CHIP refused the send; left pending`, describeError(err));
        await releaseClaim(awardId);
        return "error";
      }
    }
    console.error(
      `Prize award ${awardId}: CHIP send may not have gone through; left processing until a re-run confirms it`,
      describeError(err),
    );
    return "error";
  }

  const { error: persistError } = await supabaseAdmin
    .from("prize_awards")
    .update({ chip_send_instruction_id: instruction.id, status: "processing" })
    .eq("id", awardId)
    .is("processed_at", null);
  if (persistError) {
    console.error(
      `Prize award ${awardId}: failed to persist instruction ${instruction.id}`,
      describeDbError(persistError),
    );
  }

  const outcome = chipSendOutcome(instruction.state);
  if (outcome === "pending") {
    console.info(`Prize award ${awardId}: sent as instruction ${instruction.id} (state ${instruction.state}); waiting for the webhook`);
    return "sent";
  }
  if (outcome === "failed") {
    return failAward(awardId, `send_instruction_${instruction.state}`, { instructionId: instruction.id });
  }

  const { error: settleError } = await settlePrizeAward({
    awardId,
    chipSendInstructionId: instruction.id,
    paid: true,
    amountCents: chipSendAmountToCents(instruction.amount) ?? award.amount_cents,
    receiptUrl: instruction.receipt_url,
  });
  if (settleError) {
    console.error(
      `Prize award ${awardId}: instruction ${instruction.id} completed but settle_prize_award failed`,
      describeDbError(settleError),
    );
    return "sent";
  }
  return "paid";
}

export async function sendAwardsAwaitingBank(userId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("prize_awards")
      .select("id")
      .eq("user_id", userId)
      .eq("approval", "approved")
      .eq("status", "pending")
      .is("processed_at", null);
    if (error) {
      console.error(`User ${userId}: failed to load prize awards awaiting a bank account`, describeDbError(error));
      return;
    }
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    for (let i = 0; i < ids.length; i += PAYOUT_CONCURRENCY) {
      await Promise.all(ids.slice(i, i + PAYOUT_CONCURRENCY).map(executePrizeAward));
    }
  } catch (err) {
    console.error(`User ${userId}: sending awaiting prize awards failed`, describeError(err));
  }
}

export async function onPlayerBankVerdict(userId: string, verified: boolean): Promise<void> {
  if (verified) {
    await sendAwardsAwaitingBank(userId);
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("prize_awards")
    .select("id")
    .eq("user_id", userId)
    .eq("approval", "approved")
    .eq("status", "pending")
    .is("processed_at", null);
  if (error) {
    console.error(`User ${userId}: failed to load prize awards for a rejected account`, describeDbError(error));
    return;
  }
  for (const { id } of (data ?? []) as { id: string }[]) {
    await notifyPrizeAwarded(id, { accountRejected: true });
  }
}
