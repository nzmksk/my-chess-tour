import type { PurchasesRequest } from "./interfaces/purchases-request";
import type { PurchasesResponse } from "./interfaces/purchases-response";
import type { RefundRequest } from "./interfaces/refund-request";
import type { RefundResponse } from "./interfaces/refund-response";

const CHIP_API_URL = "https://gate.chip-in.asia/api/v1";

export const PAYMENT_TIMEOUT_MINUTES = 10;
export const PAYMENT_TIMEOUT_INTERVAL = `${PAYMENT_TIMEOUT_MINUTES} minutes`;

const SUCCESS_STATUSES = new Set(["paid", "cleared", "settled"]);
const SUCCESS_EVENTS = new Set(["purchase.paid", "purchase.captured"]);
const FAILURE_STATUSES = new Set(["error", "cancelled"]);
const FAILURE_EVENTS = new Set([
  "purchase.payment_failure",
  "purchase.cancelled",
]);

export type ChipOutcome = "paid" | "failed" | "pending";

export function chipOutcome(status?: string, eventType?: string): ChipOutcome {
  const s = (status ?? "").toLowerCase();
  const e = (eventType ?? "").toLowerCase();
  if (SUCCESS_STATUSES.has(s) || SUCCESS_EVENTS.has(e)) return "paid";
  if (FAILURE_STATUSES.has(s) || FAILURE_EVENTS.has(e)) return "failed";
  return "pending";
}

const REFUND_SUCCESS_STATUSES = new Set(["refunded"]);
const REFUND_SUCCESS_EVENTS = new Set(["payment.refunded"]);
const REFUND_FAILURE_EVENTS = new Set(["purchase.refund_failure"]);

const REFUND_EVENTS = new Set([
  "payment.refunded",
  "purchase.refund_failure",
  "purchase.pending_refund",
]);

export function isChipRefundEvent(eventType?: string, status?: string): boolean {
  const e = (eventType ?? "").toLowerCase();
  const s = (status ?? "").toLowerCase();
  return REFUND_EVENTS.has(e) || s === "refunded" || s === "pending_refund";
}

export type ChipRefundOutcome = "refunded" | "failed" | "pending";

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
    body: request == null ? undefined : JSON.stringify(request),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CHIP API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<RefundResponse>;
}
