import type { PurchasesRequest } from "./interfaces/purchases-request";
import type { PurchasesResponse } from "./interfaces/purchases-response";
import type { RefundRequest } from "./interfaces/refund-request";
import type { RefundResponse } from "./interfaces/refund-response";

const CHIP_API_URL = "https://gate.chip-in.asia/api/v1";

// CHIP emits no expiry webhook (see wiki/chip-webhook.md), so expiry is owned by
// us. A single window governs everything: the CHIP purchase `due` paired with
// `purchase.due_strict` (which is what actually makes the link unpayable — `due`
// on its own only marks it `overdue` and CHIP keeps accepting payment), the
// reservation seat hold (db/migrations/003_functions_triggers.sql), "is this
// pending attempt still live" on resume, and the threshold past which an
// abandoned registration is terminalized. A payment made just before `due` whose
// webhook lands late can still rescue a just-expired registration in
// settle_registration_payment (real money wins), so no extra safety buffer is
// needed.
export const PAYMENT_TIMEOUT_MINUTES = 10;
// As a Postgres interval literal for the expire_stale_pending_payments RPC.
export const PAYMENT_TIMEOUT_INTERVAL = `${PAYMENT_TIMEOUT_MINUTES} minutes`;

// CHIP events/statuses that mean the money cleared (purchase.captured carries
// status "paid" too, but we list it explicitly for clarity).
const SUCCESS_STATUSES = new Set(["paid"]);
const SUCCESS_EVENTS = new Set(["purchase.paid", "purchase.captured"]);
// Terminal failure signals. Everything else (created, pending_*, hold, viewed,
// settled, refunds, payouts, chargebacks, …) is treated as still pending.
//
// `expired` and `overdue` are deliberately NOT failures. Because we send
// `due_strict`, a lapsed purchase reaches `expired` at CHIP — but the app owns
// expiry, and its terminal state is `cancelled_payment` (via
// expire_stale_pending_payments), not `failed_payment`. Mapping them to "failed"
// here would make the reconcile path settle the payment row as failed and land
// the registration in the wrong terminal state.
const FAILURE_STATUSES = new Set(["error", "cancelled"]);
const FAILURE_EVENTS = new Set([
  "purchase.payment_failure",
  "purchase.cancelled",
]);

export type ChipOutcome = "paid" | "failed" | "pending";

/**
 * Maps a CHIP purchase `status` and/or webhook `event_type` to a settlement
 * outcome. Shared by the webhook handler and the post-payment page resolver so
 * the two can't drift.
 *
 * Note: refund/payout events (`payment.refunded`, `purchase.refund_failure`, …)
 * are intentionally NOT matched here — they fall through to `"pending"` so the
 * registration settlement path ignores them. Refund events have their own mapper
 * (`chipRefundOutcome`).
 */
export function chipOutcome(status?: string, eventType?: string): ChipOutcome {
  const s = (status ?? "").toLowerCase();
  const e = (eventType ?? "").toLowerCase();
  if (SUCCESS_STATUSES.has(s) || SUCCESS_EVENTS.has(e)) return "paid";
  if (FAILURE_STATUSES.has(s) || FAILURE_EVENTS.has(e)) return "failed";
  return "pending";
}

// CHIP refund lifecycle signals. Success delivers a `payment.refunded` event
// (the original purchase becomes `refunded`); `purchase.refund_failure` is a
// terminal failure; `pending_refund` means the refund is still processing on the
// acquirer side and a `payment.refunded` will follow. See wiki/chip-webhook.md.
const REFUND_SUCCESS_STATUSES = new Set(["refunded"]);
const REFUND_SUCCESS_EVENTS = new Set(["payment.refunded"]);
const REFUND_FAILURE_EVENTS = new Set(["purchase.refund_failure"]);

// The three refund lifecycle events. Used by the webhook handler to route a
// delivery to the refund path instead of the registration-settlement path.
const REFUND_EVENTS = new Set([
  "payment.refunded",
  "purchase.refund_failure",
  "purchase.pending_refund",
]);

/**
 * True when a webhook delivery is about a refund (by event type, or a refund
 * purchase status) and should be handled by the refund-settlement path rather
 * than registration settlement.
 */
export function isChipRefundEvent(eventType?: string, status?: string): boolean {
  const e = (eventType ?? "").toLowerCase();
  const s = (status ?? "").toLowerCase();
  return REFUND_EVENTS.has(e) || s === "refunded" || s === "pending_refund";
}

export type ChipRefundOutcome = "refunded" | "failed" | "pending";

/**
 * Maps a CHIP refund `status` and/or webhook `event_type` to a refund settlement
 * outcome. Shared by the webhook handler and the synchronous refund-response
 * handler so the two can't drift. Anything not recognised (e.g. `pending_refund`)
 * is `"pending"` — the authoritative `payment.refunded` webhook settles later.
 */
export function chipRefundOutcome(
  status?: string,
  eventType?: string,
): ChipRefundOutcome {
  const s = (status ?? "").toLowerCase();
  const e = (eventType ?? "").toLowerCase();
  if (REFUND_SUCCESS_STATUSES.has(s) || REFUND_SUCCESS_EVENTS.has(e))
    return "refunded";
  if (REFUND_FAILURE_EVENTS.has(e)) return "failed";
  return "pending";
}

/**
 * Creates a CHIP purchase (POST /purchases/). The caller supplies the full CHIP
 * request payload; `brand_id` is injected here because it comes from the
 * environment alongside the API key.
 */
export async function createChipPurchase(
  request: Omit<PurchasesRequest, "brand_id">,
): Promise<PurchasesResponse> {
  const apiKey = process.env.CHIP_API_KEY;
  const brandId = process.env.CHIP_BRAND_ID;

  if (!apiKey || !brandId) {
    throw new Error("CHIP_API_KEY and CHIP_BRAND_ID must be configured");
  }

  const res = await fetch(`${CHIP_API_URL}/purchases/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...request, brand_id: brandId }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CHIP API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<PurchasesResponse>;
}

/**
 * Fetches the current state of a purchase from CHIP. Used to reconcile the
 * post-payment return pages when the webhook hasn't arrived yet. Callers read
 * `status` for the outcome and `purchase.total` for the amount CHIP actually
 * charged — the latter guards settlement against a stale/re-priced purchase
 * being paid.
 */
export async function getChipPurchase(id: string): Promise<PurchasesResponse> {
  const apiKey = process.env.CHIP_API_KEY;
  if (!apiKey) {
    throw new Error("CHIP_API_KEY must be configured");
  }

  const res = await fetch(`${CHIP_API_URL}/purchases/${id}/`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CHIP API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<PurchasesResponse>;
}

/**
 * Cancels a CHIP purchase so a previously-issued checkout link can no longer be
 * paid. Called when a registration's payment is re-priced/resumed and a fresh
 * purchase is about to be created — leaving the old one payable would risk a
 * double charge. Best-effort: callers log and continue on failure.
 */
export async function cancelChipPurchase(id: string): Promise<void> {
  const apiKey = process.env.CHIP_API_KEY;
  if (!apiKey) {
    throw new Error("CHIP_API_KEY must be configured");
  }

  const res = await fetch(`${CHIP_API_URL}/purchases/${id}/cancel/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CHIP API error ${res.status}: ${body}`);
  }
}

/**
 * Issues a refund against an already-paid CHIP purchase (POST
 * /purchases/{id}/refund/). `purchaseId` is the ORIGINAL purchase id (stored as
 * the registration payment's chip_transaction_id). Omitting `request` refunds the
 * full purchase; `{ amount }` refunds that many minor units (must not exceed the
 * purchase's `refundable_amount`).
 *
 * The 200 body has **two shapes** — see `RefundResponse`. A refund that cleared
 * synchronously returns the refund Payment (whose `id` is a NEW Payment id,
 * distinct from the purchase id, and which carries no `status`); one still
 * processing on the acquirer side returns the original Purchase with
 * `status: "pending_refund"`, to be finalised later by the `payment.refunded`
 * webhook. Narrow with `isPendingRefund` before reading either.
 *
 * Throws on a non-2xx response so the caller can leave the refund pending for
 * retry. Note a 400 (`purchase_refund_error`) carries no detail in its body; the
 * reason is on the Purchase at `transaction_data.attempts[0].error`.
 */
export async function refundChipPurchase(
  purchaseId: string,
  request?: RefundRequest,
): Promise<RefundResponse> {
  const apiKey = process.env.CHIP_API_KEY;
  if (!apiKey) {
    throw new Error("CHIP_API_KEY must be configured");
  }

  const res = await fetch(`${CHIP_API_URL}/purchases/${purchaseId}/refund/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    // Omit the body entirely for a full refund; CHIP treats a missing amount as
    // "refund the whole purchase".
    body: request == null ? undefined : JSON.stringify(request),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CHIP API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<RefundResponse>;
}
