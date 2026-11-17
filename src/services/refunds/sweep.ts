import { supabaseAdmin } from "@/services/supabase/admin";
import { fireRefund, type RefundFireOutcome } from "@/services/refunds/fire";

// The refund sweep (POST /api/v1/cron/refunds, #496): sends the refunds that a
// cancellation approval queued to CHIP, off the admin's request.
//
// Approving a cancellation used to fire every player's refund inside that
// request. For a tournament with hundreds of confirmed players that can run
// past the serverless function's time limit, leaving the rest unfired. Now
// the approval only queues them (review_tournament_cancellation, atomically
// with the cancellation) and this sweep fires them, a bounded chunk per call.
//
// Each call stops starting new CHIP calls once its time budget is spent and
// says whether work is left (`more`). The scheduled job calls again until it
// isn't, so a large cancellation drains over several short calls rather than
// one long one.
//
// Safe to run at any time and to overlap: fireRefund claims each refund under
// a row lock first (claim_refund_fire), so two sweeps, or a sweep and an
// admin's Retry, reach CHIP once. A refund the sweep claims but that doesn't
// settle drops off its list for good and, once REFUND_STUCK_AFTER_MINUTES have
// passed, shows on the admin Stuck refunds page for a retry.

/**
 * How long after the approval a refund waits before the sweep picks it up.
 * The approval emails players that the tournament is off after its response;
 * a refund that settles on the spot emails "refund completed", which must not
 * land first.
 */
export const REFUND_SWEEP_GRACE_INTERVAL = "1 minute";

/**
 * How long one call keeps starting new CHIP refunds. Sized for the tightest
 * function limit the app may run under (Netlify's synchronous functions can be
 * held to 10 seconds), leaving room for the last batch to finish and the
 * response to go out.
 */
export const REFUND_SWEEP_BUDGET_MS = 6_000;

// How many CHIP refund calls to have in flight at once. Bounds the fan-out so a
// large tournament doesn't open dozens of concurrent connections to CHIP.
const REFUND_CONCURRENCY = 5;

// The most refunds one call loads. More than the budget usually gets through;
// a full page means there may be more, and the job calls again.
const REFUND_SWEEP_PAGE_SIZE = 100;

export type RefundSweepTally = Partial<Record<RefundFireOutcome, number>>;

export interface RefundSweepStats {
  /** Refunds this call handed to fireRefund. */
  fired: number;
  /** What those came to, by fireRefund outcome. */
  outcomes: RefundSweepTally;
  /**
   * Whether unfired refunds may be left: the budget ran out first, or the page
   * was full. The scheduled job calls again while this is true.
   */
  more: boolean;
}

/**
 * Fires unfired cancellation refunds, oldest first, REFUND_CONCURRENCY at a
 * time, until they run out or `budgetMs` has passed. Per-refund failures are
 * tallied and skipped (fireRefund never throws). Throws only when the work list
 * can't be loaded, so the route can report the run as failed.
 */
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
