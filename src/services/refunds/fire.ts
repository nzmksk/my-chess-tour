import { supabaseAdmin } from "@/services/supabase/admin";
import { chipRefundOutcome, refundChipPurchase } from "@/services/chip/chip";
import { isPendingRefund } from "@/services/chip/interfaces/refund-response";
import {
  notifyRefundSettlement,
  type SettleRefundResult,
} from "@/services/refunds/notify";

/**
 * How long a fired refund may go without an answer before it counts as stuck
 * and may be fired again. CHIP's refund webhooks normally land within seconds;
 * anything still unsettled after this long is worth a look. A refund CHIP
 * reports failed is due again straight away (see refund_fire_due).
 */
export const REFUND_STUCK_AFTER_MINUTES = 15;
// As a Postgres interval literal for claim_refund_fire / list_stuck_refunds.
export const REFUND_STUCK_AFTER_INTERVAL = `${REFUND_STUCK_AFTER_MINUTES} minutes`;

/** Why claim_refund_fire refused to let this refund be fired. */
export type RefundFireRefusal =
  | "settled"
  | "rejected"
  | "in_flight"
  | "no_purchase"
  | "not_found";

/**
 * What one attempt to fire a refund came to.
 *
 * - `refunded`: CHIP refunded it on the spot and it is settled.
 * - `processing`: CHIP has it (`pending_refund`); the payment.refunded webhook
 *   settles it.
 * - `failed`: CHIP answered with a failure. Nothing is recorded here: only the
 *   purchase.refund_failure webhook marks a refund failed (#512).
 * - `error`: CHIP couldn't be reached, refused the call, or the settle didn't
 *   write. Safe to try again once the refund is due.
 * - a {@link RefundFireRefusal}: the claim refused; CHIP wasn't called.
 */
export type RefundFireOutcome =
  | "refunded"
  | "processing"
  | "failed"
  | "error"
  | RefundFireRefusal;

type ClaimResult =
  | { claimed: true; original_chip_purchase_id: string }
  | { claimed: false; reason: RefundFireRefusal };

// Settles a refund CHIP says is done, then emails the player if this call is
// the one that settled it. Returns false when settle_refund didn't write.
async function settlePaid(
  refundId: string,
  chipRefundId: string | null,
  paymentMethod: string | null,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("settle_refund", {
    p_refund_id: refundId,
    p_chip_refund_id: chipRefundId,
    p_paid: true,
    p_payment_method: paymentMethod,
  });
  if (error) {
    console.error(`Refund ${refundId}: settle_refund failed`, error);
    return false;
  }
  // Emails the player only if this call, not the webhook, settled it.
  await notifyRefundSettlement(refundId, data as SettleRefundResult | null);
  return true;
}

/**
 * Fires one refund through CHIP and settles it if CHIP answers on the spot.
 * Shared by the cancellation approval (the first fire) and the admin re-fire of
 * a stuck refund.
 *
 * claim_refund_fire runs first. It is what makes this safe to call for any
 * refund at any time: it refuses a refund whose money already moved, one fired
 * too recently to be stuck, and a second caller racing the first.
 *
 * Best-effort and never throws. Anything short of `refunded`
 * leaves the refund pending, which is what puts it back on the stuck list.
 */
export async function fireRefund(refundId: string): Promise<RefundFireOutcome> {
  const { data: claimData, error: claimError } = await supabaseAdmin.rpc(
    "claim_refund_fire",
    { p_refund_id: refundId, p_min_age: REFUND_STUCK_AFTER_INTERVAL },
  );
  if (claimError) {
    console.error(`Refund ${refundId}: claim_refund_fire failed; not fired`, claimError);
    return "error";
  }
  const claim = claimData as ClaimResult | null;
  if (!claim?.claimed) {
    const reason = claim?.reason ?? "not_found";
    const log = reason === "no_purchase" ? console.error : console.info;
    log(`Refund ${refundId}: not fired (${reason})`);
    return reason;
  }
  const purchaseId = claim.original_chip_purchase_id;

  let result;
  try {
    // No amount → full refund of what the player paid.
    result = await refundChipPurchase(purchaseId);
  } catch (err) {
    console.error(`Refund ${refundId}: CHIP refund call failed; left pending`, err);
    return "error";
  }

  if (!isPendingRefund(result)) {
    // A Payment object came back, which *is* the completed refund — settle now.
    // `result.id` is the new refund Payment id. The later payment.refunded
    // webhook is an idempotent no-op.
    return (await settlePaid(refundId, result.id, null)) ? "refunded" : "error";
  }

  // A Purchase came back instead. Normally that means `pending_refund`; classify
  // via the shared mapper so an unexpected status is still treated as a failure.
  if (chipRefundOutcome(result.status) === "failed") {
    console.error(
      `Refund ${refundId}: CHIP reported failure synchronously; left pending`,
    );
    return "failed";
  }

  // pending_refund — the acquirer is still processing and no refund Payment
  // exists yet, so there is no chip_refund_id to record: `result.id` here is the
  // *purchase* id, not a refund id. The payment.refunded webhook settles the
  // refund and stamps the real id (correlation goes via related_to regardless).
  console.info(
    `Refund ${refundId}: CHIP returned pending_refund; awaiting payment.refunded webhook`,
  );
  return "processing";
}

// How many CHIP refund calls to have in flight at once. Bounds the fan-out for a
// large tournament so we don't open hundreds of concurrent connections in a
// single request.
const REFUND_CONCURRENCY = 5;

/**
 * Fires the CHIP refund for every pending refund queued when a tournament's
 * cancellation was approved. Best-effort and concurrency-capped: one player's
 * failure never blocks the others or fails the (already-committed)
 * cancellation. A refund that doesn't go through shows up on the admin's stuck
 * refunds page once it is due.
 */
export async function initiateCancellationRefunds(
  tournamentId: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "list_pending_cancellation_refunds",
    { p_tournament_id: tournamentId },
  );

  if (error) {
    console.error(
      `Failed to load pending refunds for cancelled tournament ${tournamentId}:`,
      error,
    );
    return;
  }

  const refunds = (data as { refund_id: string }[] | null) ?? [];
  for (let i = 0; i < refunds.length; i += REFUND_CONCURRENCY) {
    const batch = refunds.slice(i, i + REFUND_CONCURRENCY);
    await Promise.allSettled(batch.map((r) => fireRefund(r.refund_id)));
  }
}
