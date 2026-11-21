import { supabaseAdmin } from "@/services/supabase/admin";
import { fireRefund, type RefundFireOutcome } from "@/services/refunds/fire";

export const REFUND_SWEEP_GRACE_INTERVAL = "1 minute";

export const REFUND_SWEEP_BUDGET_MS = 6_000;

const REFUND_CONCURRENCY = 5;

const REFUND_SWEEP_PAGE_SIZE = 100;

export type RefundSweepTally = Partial<Record<RefundFireOutcome, number>>;

export interface RefundSweepStats {
  fired: number;
  outcomes: RefundSweepTally;
  more: boolean;
}

export async function sweepUnfiredRefunds({
  budgetMs = REFUND_SWEEP_BUDGET_MS,
  now = Date.now,
}: { budgetMs?: number; now?: () => number } = {}): Promise<RefundSweepStats> {
  const deadline = now() + budgetMs;

  const { data, error } = await supabaseAdmin.rpc(
    "list_unfired_cancellation_refunds",
    { p_min_age: REFUND_SWEEP_GRACE_INTERVAL, p_limit: REFUND_SWEEP_PAGE_SIZE },
  );
  if (error) {
    throw new Error(
      `Refund sweep: couldn't load unfired refunds: ${error.message ?? String(error)}`,
    );
  }

  const refunds = (data as { refund_id: string }[] | null) ?? [];
  const stats: RefundSweepStats = { fired: 0, outcomes: {}, more: false };

  for (let i = 0; i < refunds.length; i += REFUND_CONCURRENCY) {
    if (now() >= deadline) {
      stats.more = true;
      return stats;
    }
    const batch = refunds.slice(i, i + REFUND_CONCURRENCY);
    const outcomes = await Promise.all(batch.map((r) => fireRefund(r.refund_id)));
    for (const outcome of outcomes) {
      stats.fired += 1;
      stats.outcomes[outcome] = (stats.outcomes[outcome] ?? 0) + 1;
    }
  }

  stats.more = refunds.length === REFUND_SWEEP_PAGE_SIZE;
  return stats;
}
