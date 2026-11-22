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

type RefundFireRefusal =
  | "settled"
  | "rejected"
  | "in_flight"
  | "no_purchase"
  | "not_found";

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
  afterResponse(() =>
    notifyRefundSettlement(refundId, data as SettleRefundResult | null),
  );
  return true;
}

function refundPaymentIdOf(purchase: PurchasesResponse): string | null {
  const entry = [...(purchase.status_history ?? [])]
    .reverse()
    .find((h) => h.status === "refunded" && h.related_object?.id);
  return entry?.related_object?.id ?? null;
}

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
    result = await refundChipPurchase(purchaseId);
  } catch (err) {
    console.error(`Refund ${refundId}: CHIP refund call failed; left pending`, err);
    return "error";
  }

  if (!isPendingRefund(result)) {
    return (await settlePaid(refundId, result.id, null)) ? "refunded" : "error";
  }

  if (chipRefundOutcome(result.status) === "failed") {
    console.error(
      `Refund ${refundId}: CHIP reported failure synchronously; left pending`,
    );
    return "failed";
  }

  console.info(
    `Refund ${refundId}: CHIP returned pending_refund; awaiting payment.refunded webhook`,
  );
  return "processing";
}
