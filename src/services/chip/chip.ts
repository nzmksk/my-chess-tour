const CHIP_API_URL = "https://gate.chip-in.asia/api/v1";

interface CreatePurchaseParams {
  amountCents: number;
  clientEmail: string;
  productName: string;
  referenceId: string;
  successRedirect: string;
  failureRedirect: string;
  /** Server-to-server callback URL; CHIP POSTs a signed Purchase here on success. */
  successCallback?: string;
}

export interface ChipPurchase {
  id: string;
  checkout_url: string;
  status: string;
}

// CHIP events/statuses that mean the money cleared (purchase.captured carries
// status "paid" too, but we list it explicitly for clarity).
const SUCCESS_STATUSES = new Set(["paid"]);
const SUCCESS_EVENTS = new Set(["purchase.paid", "purchase.captured"]);
// Terminal failure signals. Everything else (created, pending_*, hold, viewed,
// settled, refunds, payouts, chargebacks, …) is treated as still pending.
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
 */
export function chipOutcome(status?: string, eventType?: string): ChipOutcome {
  const s = (status ?? "").toLowerCase();
  const e = (eventType ?? "").toLowerCase();
  if (SUCCESS_STATUSES.has(s) || SUCCESS_EVENTS.has(e)) return "paid";
  if (FAILURE_STATUSES.has(s) || FAILURE_EVENTS.has(e)) return "failed";
  return "pending";
}

export async function createChipPurchase(
  params: CreatePurchaseParams,
): Promise<ChipPurchase> {
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
    body: JSON.stringify({
      purchase: {
        currency: "MYR",
        products: [
          {
            name: params.productName,
            price: params.amountCents,
            quantity: 1,
          },
        ],
      },
      client: { email: params.clientEmail },
      brand_id: brandId,
      reference: params.referenceId,
      success_redirect: params.successRedirect,
      failure_redirect: params.failureRedirect,
      ...(params.successCallback
        ? { success_callback: params.successCallback }
        : {}),
      send_receipt: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CHIP API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<ChipPurchase>;
}

/**
 * Fetches the current state of a purchase from CHIP. Used to reconcile the
 * post-payment return pages when the webhook hasn't arrived yet.
 */
export async function getChipPurchase(
  id: string,
): Promise<{ id: string; status: string }> {
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

  return res.json() as Promise<{ id: string; status: string }>;
}
