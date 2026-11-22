import { supabaseAdmin } from "@/services/supabase/admin";
import {
  ChipSendError,
  chipSendAmountToCents,
  chipSendOutcome,
  getChipSendInstruction,
} from "@/services/chip/send";
import {
  MIN_PAYOUT_CENTS,
  PAYOUT_CONCURRENCY,
  PAYOUT_HOLD_DAYS,
  PAYOUT_STUCK_HOURS,
} from "./constants";
import { type ExecutePayoutResult, executePayout } from "./execute";
import { settlePayout } from "./settle";

type OutcomeTally = Record<ExecutePayoutResult, number>;

export interface PassStats extends OutcomeTally {
  checked: number;
}

export interface SweepStats extends OutcomeTally {
  swept: number;
  queued: number;
}

function emptyTally(): OutcomeTally {
  return {
    sent: 0,
    paid: 0,
    failed: 0,
    awaiting_budget: 0,
    blocked: 0,
    skipped: 0,
    error: 0,
  };
}

export class PayoutPassError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "PayoutPassError";
  }
}

function describeError(err: unknown): string {
  if (err instanceof ChipSendError) return `CHIP Send ${err.status}`;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const { code, message } = err as { code?: string; message: unknown };
    return code ? `${code}: ${String(message)}` : String(message);
  }
  return String(err);
}

async function tallyInBatches<T>(
  items: T[],
  label: (item: T) => string,
  fn: (item: T) => Promise<ExecutePayoutResult>,
  tally: OutcomeTally,
): Promise<void> {
  for (let i = 0; i < items.length; i += PAYOUT_CONCURRENCY) {
    const batch = items.slice(i, i + PAYOUT_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (item) => {
        try {
          return await fn(item);
        } catch (err) {
          console.error(
            `Payout run: unexpected error on ${label(item)}: ${describeError(err)}`,
          );
          return "error" as const;
        }
      }),
    );
    for (const outcome of outcomes) tally[outcome]++;
  }
}

interface StuckRow {
  id: string;
  chip_send_instruction_id: number | null;
}

async function reconcileFromChip(
  payoutId: string,
  instructionId: number,
): Promise<ExecutePayoutResult> {
  let instruction;
  try {
    instruction = await getChipSendInstruction(instructionId);
  } catch (err) {
    console.error(
      `Payout ${payoutId}: could not read instruction ${instructionId} from CHIP; left processing (${describeError(err)})`,
    );
    return "error";
  }

  const outcome = chipSendOutcome(instruction.state);
  if (outcome === "pending") {
    console.warn(
      `Payout ${payoutId}: instruction ${instructionId} is still ${instruction.state} at CHIP after ${PAYOUT_STUCK_HOURS}h; left processing`,
    );
    return "sent";
  }

  const paid = outcome === "completed";
  const { error, settled } = await settlePayout({
    payoutId,
    chipSendInstructionId: instructionId,
    paid,
    amountCents: paid ? chipSendAmountToCents(instruction.amount) : null,
    receiptUrl: paid ? instruction.receipt_url : null,
    failureReason: paid
      ? null
      : `send_instruction_${String(instruction.state).toLowerCase()}`,
  });
  if (error) {
    console.error(
      `Payout ${payoutId}: CHIP reports instruction ${instructionId} ${instruction.state}, but settle_payout failed; left processing (${describeError(error)})`,
    );
    return "error";
  }
  if (!settled) return "skipped";

  console.info(
    `Payout ${payoutId}: reconciled from CHIP as ${paid ? "paid" : "failed"} (instruction ${instructionId} ${instruction.state})`,
  );
  return paid ? "paid" : "failed";
}

export async function reconcileStuckPayouts(
  now: Date = new Date(),
): Promise<PassStats> {
  const cutoff = new Date(now.getTime() - PAYOUT_STUCK_HOURS * 3_600_000);
  const { data, error } = await supabaseAdmin
    .from("payouts")
    .select("id, chip_send_instruction_id")
    .eq("status", "processing")
    .is("processed_at", null)
    .lt("updated_at", cutoff.toISOString())
    .order("updated_at", { ascending: true });
  if (error) {
    throw new PayoutPassError("failed to load stuck payouts", error);
  }

  const rows = (data ?? []) as StuckRow[];
  const stats: PassStats = { checked: rows.length, ...emptyTally() };
  await tallyInBatches(
    rows,
    (row) => `stuck payout ${row.id}`,
    (row) =>
      row.chip_send_instruction_id === null
        ? executePayout(row.id)
        : reconcileFromChip(row.id, row.chip_send_instruction_id),
    stats,
  );
  return stats;
}

export async function retryPendingPayouts(): Promise<PassStats> {
  const { data, error } = await supabaseAdmin
    .from("payouts")
    .select("id")
    .eq("status", "pending")
    .eq("approval", "approved")
    .is("processed_at", null)
    .order("requested_at", { ascending: true });
  if (error) {
    throw new PayoutPassError("failed to load pending payouts", error);
  }

  const rows = (data ?? []) as { id: string }[];
  const stats: PassStats = { checked: rows.length, ...emptyTally() };
  await tallyInBatches(
    rows,
    (row) => `pending payout ${row.id}`,
    (row) => executePayout(row.id),
    stats,
  );
  return stats;
}

interface PayableTournament {
  tournament_id: string;
  available_cents: number;
}

async function payTournament(
  tournament: PayableTournament,
  counters: { queued: number },
): Promise<ExecutePayoutResult> {
  const tournamentId = tournament.tournament_id;
  const { data: payoutId, error } = await supabaseAdmin.rpc("queue_payout", {
    p_tournament_id: tournamentId,
    p_kind: "automatic",
    p_amount_cents: null,
    p_requested_by: null,
  });

  if (error) {
    if (error.code === "P0001") {
      console.warn(
        `Payout sweep: queue_payout refused tournament ${tournamentId}: ${error.message}`,
      );
      return "skipped";
    }
    console.error(
      `Payout sweep: queue_payout failed for tournament ${tournamentId}: ${describeError(error)}`,
    );
    return "error";
  }

  if (!payoutId) {
    console.info(
      `Payout sweep: tournament ${tournamentId} already has an automatic payout`,
    );
    return "skipped";
  }

  counters.queued++;
  const outcome = await executePayout(payoutId as string);
  console.info(
    `Payout sweep: queued payout ${String(payoutId)} for tournament ${tournamentId} (${tournament.available_cents} cents available): ${outcome}`,
  );
  return outcome;
}

export async function sweepPayableTournaments(): Promise<SweepStats> {
  const { data, error } = await supabaseAdmin.rpc("list_payable_tournaments", {
    p_hold_days: PAYOUT_HOLD_DAYS,
    p_min_cents: MIN_PAYOUT_CENTS,
  });
  if (error) {
    throw new PayoutPassError("list_payable_tournaments failed", error);
  }

  const tournaments = (data ?? []) as PayableTournament[];
  const counters = { queued: 0 };
  const tally = emptyTally();
  await tallyInBatches(
    tournaments,
    (t) => `tournament ${t.tournament_id}`,
    (t) => payTournament(t, counters),
    tally,
  );
  return { swept: tournaments.length, queued: counters.queued, ...tally };
}
