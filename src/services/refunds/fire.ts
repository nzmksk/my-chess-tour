import { supabaseAdmin } from "@/services/supabase/admin";
import {
  chipRefundOutcome,
  getChipPurchase,
  refundChipPurchase,
} from "@/services/chip/chip";
import { isPendingRefund } from "@/services/chip/interfaces/refund-response";
import type { PurchasesResponse } from "@/services/chip/interfaces/purchases-response";
import {
  notifyRefundSettlement,
  type SettleRefundResult,
} from "@/services/refunds/notify";
import { REFUND_STUCK_AFTER_INTERVAL } from "@/lib/refunds/stuck-after";
import { afterResponse } from "@/lib/http/after-response";

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
 * - `reconciled`: (re-fire only) CHIP had already refunded the purchase, so it
 *   was settled from CHIP's record instead of being refunded again.
 * - `failed`: CHIP answered with a failure. Nothing is recorded here: only the
 *   purchase.refund_failure webhook marks a refund failed (#512).
 * - `error`: CHIP couldn't be reached, refused the call, or the settle didn't
 *   write. Safe to try again once the refund is due.
 * - `needs_attention`: (re-fire only) CHIP shows the purchase partly refunded.
 *   Settling it as a full refund would be wrong, so a person has to decide.
 * - a {@link RefundFireRefusal}: the claim refused; CHIP wasn't called.
 */
export type RefundFireOutcome =
  | "refunded"
  | "processing"
  | "reconciled"
  | "failed"
  | "error"
  | "needs_attention"
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
  // Emails the player only if this call, not the webhook, settled it. Sent
  // after the response of whichever request fired the refund.
  afterResponse(() =>
    notifyRefundSettlement(refundId, data as SettleRefundResult | null),
  );
  return true;
}

// The refund Payment behind a `refunded` purchase: the status-history entry for
// the change to `refunded` carries it as its related object.
function refundPaymentIdOf(purchase: PurchasesResponse): string | null {
  const entry = [...(purchase.status_history ?? [])]
    .reverse()
    .find((h) => h.status === "refunded" && h.related_object?.id);
  return entry?.related_object?.id ?? null;
}

/**
 * Before re-POSTing a refund, asks CHIP what already happened to the purchase.
 * The cases a re-fire exists for (a missed or mis-correlated webhook, an
 * acquirer that answered `pending_refund` and went quiet) all leave money that
 * may already have moved, and re-POSTing /refund/ on a refunded purchase only
 * gets a 400 purchase_refund_error. Returns an outcome when the purchase settles
 * the question, or null when it is still refundable and the caller should POST.
 */
async function reconcileWithChip(
  refundId: string,
  purchaseId: string,
): Promise<RefundFireOutcome | null> {
  let purchase: PurchasesResponse;
  try {
    purchase = await getChipPurchase(purchaseId);
  } catch (err) {
    console.error(
      `Refund ${refundId}: couldn't read purchase ${purchaseId} from CHIP; not re-fired`,
      err,
    );
    return "error";
  }

  if (purchase.status === "pending_refund") {
    console.info(
      `Refund ${refundId}: CHIP is still processing the refund (pending_refund); not re-fired`,
    );
    return "processing";
  }

  if (purchase.status === "refunded") {
    if ((purchase.refundable_amount ?? 0) > 0) {
      console.error(
        `Refund ${refundId}: purchase ${purchaseId} is partly refunded at CHIP ` +
          `(${purchase.refundable_amount} still refundable); left for a person to resolve`,
      );
      return "needs_attention";
    }
    // The money went back but we never heard: settle from CHIP's record.
    const settled = await settlePaid(
      refundId,
      refundPaymentIdOf(purchase),
      purchase.transaction_data?.payment_method ?? null,
    );
    if (!settled) return "error";
    console.info(
      `Refund ${refundId}: CHIP had already refunded purchase ${purchaseId}; settled from its record`,
    );
    return "reconciled";
  }

  return null;
}

/**
 * Fires one refund through CHIP and settles it if CHIP answers on the spot.
 * Shared by the refund sweep (the first fire, src/services/refunds/sweep.ts)
 * and the admin re-fire of a stuck refund (`reconcile: true`, which checks the
 * purchase at CHIP first).
 *
 * claim_refund_fire runs first. It is what makes this safe to call for any
 * refund at any time: it refuses a refund whose money already moved, one fired
 * too recently to be stuck, and a second caller racing the first.
 *
 * Best-effort and never throws. Anything short of `refunded` / `reconciled`
 * leaves the refund pending, which is what puts it back on the stuck list.
 */
export async function fireRefund(
  refundId: string,
  { reconcile = false }: { reconcile?: boolean } = {},
): Promise<RefundFireOutcome> {
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

  if (reconcile) {
    const known = await reconcileWithChip(refundId, purchaseId);
    if (known) return known;
  }

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
