// How a refund reads to the people waiting on it. Pure, so the player's and the
// organizer's views (server and client) share one definition.

/**
 * - `refunded`: settle_refund booked it (processed_at); the money has left.
 * - `failed`: CHIP reported a failure (failed_at) and nothing has cleared since.
 *   The refund is still owed: it stays pending for a retry.
 * - `processing`: queued or in flight with CHIP, nothing back yet.
 *
 * processed_at wins over failed_at: a retry that clears after a failure is
 * refunded, and failed_at stays only as history.
 */
export type RefundState = "processing" | "refunded" | "failed";

export function refundState(refund: {
  processed_at: string | null;
  failed_at: string | null;
}): RefundState {
  if (refund.processed_at) return "refunded";
  if (refund.failed_at) return "failed";
  return "processing";
}

/**
 * The refund a registration's view should show: the live one. A rejected refund
 * is a closed request (at most one live refund exists per registration, enforced
 * by uniq_active_refund_per_registration), so it is skipped.
 */
export function liveRefund<T extends { status: string }>(
  refunds: readonly T[] | null | undefined,
): T | null {
  return refunds?.find((r) => r.status !== "rejected") ?? null;
}
