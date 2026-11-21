export type RefundState = "processing" | "refunded" | "failed";

export function refundState(refund: {
  processed_at: string | null;
  failed_at: string | null;
}): RefundState {
  if (refund.processed_at) return "refunded";
  if (refund.failed_at) return "failed";
  return "processing";
}

export function liveRefund<T extends { status: string }>(
  refunds: readonly T[] | null | undefined,
): T | null {
  return refunds?.find((r) => r.status !== "rejected") ?? null;
}
