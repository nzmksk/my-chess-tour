import { supabaseAdmin } from "@/services/supabase/admin";
import {
  chipSendAmountToCents,
  chipSendOutcome,
  getChipSendInstruction,
} from "@/services/chip/send";
import { PAYOUT_CONCURRENCY, PAYOUT_STUCK_HOURS } from "@/services/payouts/constants";
import { PayoutPassError, type PassStats } from "@/services/payouts/sweep";
import { describeSendError } from "@/services/payouts/send-errors";
import { executePrizeAward, type ExecutePrizeAwardResult } from "./execute";
import { settlePrizeAward } from "./settle";

// The prize award passes of the daily run (POST /api/v1/cron/payouts), the twins
// of the payout reconciler and retry pass (src/services/payouts/sweep.ts):
//
//   1. reconcileStuckPrizeAwards  `processing` for over PAYOUT_STUCK_HOURS. With an
//                                 instruction, ask CHIP and settle; without one,
//                                 resume the send.
//   2. retryPendingPrizeAwards    approved awards still `pending`: waiting on the
//                                 winner's bank account (this also registers a
//                                 pending one with CHIP), parked on budget, or
//                                 left by a transient error.
//
// Both are safe to re-run: CHIP dedupes on `reference` and settle_prize_award
// no-ops on a settled row. Only failing to load a work list throws.

function emptyStats(checked: number): PassStats {
  return {
    checked,
    sent: 0,
    paid: 0,
    failed: 0,
    awaiting_budget: 0,
    blocked: 0,
    skipped: 0,
    error: 0,
  };
}

async function tally(
  ids: string[],
  fn: (id: string) => Promise<ExecutePrizeAwardResult>,
): Promise<PassStats> {
  const stats = emptyStats(ids.length);
  for (let i = 0; i < ids.length; i += PAYOUT_CONCURRENCY) {
    const outcomes = await Promise.all(
      ids.slice(i, i + PAYOUT_CONCURRENCY).map(async (id) => {
        try {
          return await fn(id);
        } catch (err) {
          console.error(`Prize run: unexpected error on award ${id}: ${describeSendError(err)}`);
          return "error" as const;
        }
      }),
    );
    for (const outcome of outcomes) stats[outcome]++;
  }
  return stats;
}

async function reconcileFromChip(
  awardId: string,
  instructionId: number,
): Promise<ExecutePrizeAwardResult> {
  let instruction;
  try {
    // The single-instruction GET: CHIP caches the list endpoint for an hour.
    instruction = await getChipSendInstruction(instructionId);
  } catch (err) {
    console.error(
      `Prize award ${awardId}: could not read instruction ${instructionId} from CHIP; left processing (${describeSendError(err)})`,
    );
    return "error";
  }

  const outcome = chipSendOutcome(instruction.state);
  if (outcome === "pending") return "sent";

  const paid = outcome === "completed";
  const { error, settled } = await settlePrizeAward({
    awardId,
    chipSendInstructionId: instructionId,
    paid,
    amountCents: paid ? chipSendAmountToCents(instruction.amount) : null,
    receiptUrl: paid ? instruction.receipt_url : null,
    failureReason: paid ? null : `send_instruction_${String(instruction.state).toLowerCase()}`,
  });
  if (error) {
    console.error(
      `Prize award ${awardId}: CHIP reports instruction ${instructionId} ${instruction.state}, but settle_prize_award failed; left processing`,
      error.message,
    );
    return "error";
  }
  if (!settled) return "skipped";
  return paid ? "paid" : "failed";
}

/**
 * Without this, a dropped webhook strands an award in `processing`, where it
 * keeps reserving pool money and the winner is never told.
 */
export async function reconcileStuckPrizeAwards(now: Date = new Date()): Promise<PassStats> {
  const cutoff = new Date(now.getTime() - PAYOUT_STUCK_HOURS * 3_600_000);
  const { data, error } = await supabaseAdmin
    .from("prize_awards")
    .select("id, chip_send_instruction_id")
    .eq("status", "processing")
    .is("processed_at", null)
    .lt("updated_at", cutoff.toISOString())
    .order("updated_at", { ascending: true });
  if (error) throw new PayoutPassError("failed to load stuck prize awards", error);

  const rows = (data ?? []) as { id: string; chip_send_instruction_id: number | null }[];
  const instructions = new Map(rows.map((r) => [r.id, r.chip_send_instruction_id]));
  return tally(rows.map((r) => r.id), (id) => {
    const instructionId = instructions.get(id);
    return instructionId != null ? reconcileFromChip(id, instructionId) : executePrizeAward(id);
  });
}

/** Every approved, unsettled award still `pending`, oldest approval first. */
export async function retryPendingPrizeAwards(): Promise<PassStats> {
  const { data, error } = await supabaseAdmin
    .from("prize_awards")
    .select("id")
    .eq("approval", "approved")
    .eq("status", "pending")
    .is("processed_at", null)
    .order("reviewed_at", { ascending: true });
  if (error) throw new PayoutPassError("failed to load pending prize awards", error);

  return tally(((data ?? []) as { id: string }[]).map((r) => r.id), executePrizeAward);
}
