import { supabaseAdmin } from "@/services/supabase/admin";
import { afterResponse } from "@/lib/http/after-response";
import { notifyPrizePaid } from "./notify";

export interface SettlePrizeAwardInput {
  awardId: string;
  chipSendInstructionId: number | null;
  paid: boolean;
  amountCents?: number | null;
  receiptUrl?: string | null;
  failureReason?: string | null;
}

export interface SettlePrizeAwardResult {
  error: { code?: string; message: string } | null;
  settled: boolean;
}

interface SettlePrizeAwardRpcResult {
  already_processed: boolean;
  over_award?: boolean;
  paid_after_failed?: boolean;
}

export async function settlePrizeAward(
  input: SettlePrizeAwardInput,
): Promise<SettlePrizeAwardResult> {
  const { data, error } = await supabaseAdmin.rpc("settle_prize_award", {
    p_award_id: input.awardId,
    p_chip_send_instruction_id: input.chipSendInstructionId,
    p_paid: input.paid,
    p_amount_cents: input.amountCents ?? null,
    p_receipt_url: input.receiptUrl ?? null,
    p_failure_reason: input.failureReason ?? null,
  });

  if (error) {
    return { error: { code: error.code, message: error.message }, settled: false };
  }

  const result = data as SettlePrizeAwardRpcResult;

  if (result.paid_after_failed) {
    console.error(
      `Prize award ${input.awardId}: CHIP reports the transfer complete, but the award was already marked failed. Money may have left with no ledger row.`,
    );
  }
  if (result.already_processed) {
    console.info(`Prize award ${input.awardId}: already settled; nothing to do`);
    return { error: null, settled: false };
  }

  if (result.over_award) {
    console.error(
      `Prize award ${input.awardId}: settled for more than the prize pool had uncommitted. Booked anyway because the money has left; this pool may now be overdrawn.`,
    );
  }

  if (input.paid) {
    console.info(
      `Prize award ${input.awardId}: paid${input.chipSendInstructionId !== null ? ` (instruction ${input.chipSendInstructionId})` : ""}`,
    );
    afterResponse(() => notifyPrizePaid(input.awardId));
  } else {
    console.error(
      `Prize award ${input.awardId}: failed (${input.failureReason ?? "send_instruction_failed"})`,
    );
  }

  return { error: null, settled: true };
}
