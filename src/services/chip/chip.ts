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

const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 250;
const MAX_RETRY_AFTER_MS = 2_000;
const RETRYABLE_STATUSES = new Set([500, 503]);

function chipApiKey(): string {
  const apiKey = process.env.CHIP_API_KEY;
  if (!apiKey) {
    throw new Error("CHIP_API_KEY must be configured");
  }
  return apiKey;
}

function backoffMs(attempt: number): number {
  const base = BASE_RETRY_DELAY_MS * 3 ** (attempt - 1);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function retryAfterMs(res: Response, attempt: number): number | null {
  const header = res.headers?.get("retry-after");
  if (header == null) return backoffMs(attempt);
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = seconds * 1000;
  return ms <= MAX_RETRY_AFTER_MS ? ms : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function chipCollectRequest(
  method: "GET" | "POST",
  path: string,
  { body, apiKey = chipApiKey() }: { body?: unknown; apiKey?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (method === "POST") headers["Idempotency-Key"] = crypto.randomUUID();
  const init: RequestInit = {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  };

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${CHIP_API_URL}${path}`, init);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      await sleep(backoffMs(attempt));
      continue;
    }
    if (res.ok) return res;

    const wait =
      attempt >= MAX_ATTEMPTS
        ? null
        : res.status === 429
          ? retryAfterMs(res, attempt)
          : RETRYABLE_STATUSES.has(res.status)
            ? backoffMs(attempt)
            : null;
    if (wait === null) {
      const text = await res.text();
      throw new Error(`CHIP API error ${res.status}: ${text}`);
    }
    await sleep(wait);
  }
}

export async function createChipPurchase(
  request: Omit<PurchasesRequest, "brand_id">,
): Promise<PurchasesResponse> {
  const apiKey = process.env.CHIP_API_KEY;
  const brandId = process.env.CHIP_BRAND_ID;

  if (!apiKey || !brandId) {
    throw new Error("CHIP_API_KEY and CHIP_BRAND_ID must be configured");
  }

  const res = await chipCollectRequest("POST", "/purchases/", {
    apiKey,
    body: { ...request, brand_id: brandId },
  });
  return res.json() as Promise<PurchasesResponse>;
}

export async function getChipPurchase(id: string): Promise<PurchasesResponse> {
  const res = await chipCollectRequest("GET", `/purchases/${id}/`);
  return res.json() as Promise<PurchasesResponse>;
}

export async function cancelChipPurchase(id: string): Promise<void> {
  await chipCollectRequest("POST", `/purchases/${id}/cancel/`);
}

export async function refundChipPurchase(
  purchaseId: string,
  request?: RefundRequest,
): Promise<RefundResponse> {
  const res = await chipCollectRequest(
    "POST",
    `/purchases/${purchaseId}/refund/`,
    { body: request ?? undefined },
  );
  return res.json() as Promise<RefundResponse>;
}
