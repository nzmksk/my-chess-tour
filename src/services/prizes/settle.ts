import { supabaseAdmin } from "@/services/supabase/admin";
import { afterResponse } from "@/lib/http/after-response";
import { notifyPrizePaid } from "./notify";

// Settlement of a prize award (#523) is reached from two paths that must agree:
// the synchronous send response in executePrizeAward, and the CHIP Send webhook.
// Both come through settlePrizeAward, so whichever arrives first books the
// type='player_prize' ledger row and emails the winner, and the other is a no-op
// (settle_prize_award's processed_at check). The settlePayout twin.

export interface SettlePrizeAwardInput {
  awardId: string;
  chipSendInstructionId: number | null;
  paid: boolean;
  amountCents?: number | null;
  receiptUrl?: string | null;
  failureReason?: string | null;
}

export interface SettlePrizeAwardResult {
  /** Set when the RPC failed; the caller decides whether that is retryable. */
  error: { code?: string; message: string } | null;
  /** True when this call changed the row (false for a no-op repeat). */
  settled: boolean;
}

interface SettlePrizeAwardRpcResult {
  already_processed: boolean;
  over_award?: boolean;
  paid_after_failed?: boolean;
}

/**
 * Settles an award via settle_prize_award and, when this call paid it, emails
 * the winner after the response. Money discrepancies are logged at error level:
 * more settled than the pool had, or CHIP completing a transfer on an award
 * already written off. Both need a person.
 */
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
    // Terminal: the organizer enters the winner again and an admin re-approves.
    // The admin prizes page and the organizer's panel both show it.
    console.error(
      `Prize award ${input.awardId}: failed (${input.failureReason ?? "send_instruction_failed"})`,
    );
  }

  return { error: null, settled: true };
}
