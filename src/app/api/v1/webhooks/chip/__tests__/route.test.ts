import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, setPaymentResult, setRefundResult } = vi.hoisted(
  () => {
    function makeBuilder(getResult: () => unknown) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "maybeSingle"]) {
        b[m] = vi.fn(() => b);
      }
      b.then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) => Promise.resolve(getResult()).then(onfulfilled, onrejected);
      return b;
    }

    // A queue of results returned for successive `from("payments")` lookups
    // (the handler may try chip_transaction_id then reference).
    let paymentResults: Array<unknown> = [];
    let idx = 0;
    const setPaymentResult = (...results: Array<unknown>) => {
      paymentResults = results;
      idx = 0;
    };

    // A queue of results for successive `from("refunds")` lookups (refund path).
    let refundResults: Array<unknown> = [];
    let ridx = 0;
    const setRefundResult = (...results: Array<unknown>) => {
      refundResults = results;
      ridx = 0;
    };

    const mockFrom = vi.fn((table: string) => {
      if (table === "payments")
        return makeBuilder(
          () => paymentResults[idx++] ?? { data: null, error: null },
        );
      if (table === "refunds")
        return makeBuilder(
          () => refundResults[ridx++] ?? { data: null, error: null },
        );
      return makeBuilder(() => ({ data: null, error: null }));
    });

    const mockRpc = vi.fn<() => Promise<{ data: unknown; error: unknown }>>(() =>
      Promise.resolve({ data: { already_processed: false }, error: null }),
    );
    return { mockFrom, mockRpc, setPaymentResult, setRefundResult };
  },
);

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Signing helpers — generate a keypair so we can produce valid signatures.
// ---------------------------------------------------------------------------

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function sign(body: string): string {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(body);
  signer.end();
  return signer.sign(privateKey, "base64");
}

function makeRequest(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return new NextRequest("http://localhost/api/v1/webhooks/chip", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": signature ?? sign(body),
    },
    body,
  });
}

beforeEach(() => {
  vi.stubEnv("CHIP_WEBHOOK_PUBLIC_KEY", publicKey);
  setPaymentResult({ data: null, error: null });
  setRefundResult({ data: null, error: null });
  // The handler logs expected failure reasons; keep test output clean.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/webhooks/chip", () => {
  it("rejects an invalid signature with 401", async () => {
    const res = await POST(
      makeRequest({ id: "chip-1", status: "paid" }, "not-a-valid-signature"),
    );

    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("settles a paid purchase and forwards the charged amount + payment method", async () => {
    setPaymentResult({
      data: { id: "pay-1", chip_transaction_id: "chip-1" },
      error: null,
    });

    const res = await POST(
      makeRequest({
        id: "chip-1",
        reference: "pay-1",
        status: "paid",
        event_type: "purchase.paid",
        purchase: { total: 5500 },
        transaction_data: { payment_method: "fpx_b2c" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("settle_registration_payment", {
      p_payment_id: "pay-1",
      p_paid: true,
      p_amount_cents: 5500,
      p_payment_method: "fpx_b2c",
    });
  });

  it("verifies when the key is wrapped in quotes and uses literal \\n", async () => {
    // Mimic a key copied verbatim from a .env file into a platform that stores
    // env values literally (e.g. Netlify): surrounding quotes + escaped newlines.
    const mangled = `"${publicKey.trim().replace(/\n/g, "\\n")}"`;
    vi.stubEnv("CHIP_WEBHOOK_PUBLIC_KEY", mangled);
    setPaymentResult({
      data: { id: "chip-1", chip_transaction_id: "chip-1" },
      error: null,
    });

    const res = await POST(
      makeRequest({
        id: "chip-1",
        status: "paid",
        event_type: "purchase.paid",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalled();
  });

  it("401s when no public key is configured", async () => {
    vi.stubEnv("CHIP_WEBHOOK_PUBLIC_KEY", "");

    const res = await POST(
      makeRequest({
        id: "chip-1",
        status: "paid",
        event_type: "purchase.paid",
      }),
    );

    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("settles the reference-matched payment (settlement gating protects the registration)", async () => {
    // Per-attempt model: each attempt is its own immutable row whose id is its
    // `reference`. settle_registration_payment only terminalizes the registration
    // for its *current* attempt, so settling a matched-by-reference row is safe
    // even if its chip id differs — no stale-purchase guard in the webhook.
    setPaymentResult(
      { data: null, error: null },
      {
        data: { id: "pay-1", chip_transaction_id: "chip-NEW" },
        error: null,
      },
    );

    const res = await POST(
      makeRequest({
        id: "chip-OLD",
        reference: "pay-1",
        status: "paid",
        event_type: "purchase.paid",
        purchase: { total: 5500 },
      }),
    );

    expect(res.status).toBe(200);
    // No transaction_data in this payload → method settles as null.
    expect(mockRpc).toHaveBeenCalledWith("settle_registration_payment", {
      p_payment_id: "pay-1",
      p_paid: true,
      p_amount_cents: 5500,
      p_payment_method: null,
    });
  });

  it("acks an intermediate (pending) event without settling", async () => {
    const res = await POST(
      makeRequest({ id: "chip-1", status: "created", event_type: "" }),
    );

    expect(res.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("acks when no payment matches", async () => {
    setPaymentResult({ data: null, error: null }, { data: null, error: null });

    const res = await POST(
      makeRequest({
        id: "chip-x",
        reference: "pay-x",
        status: "error",
        event_type: "purchase.payment_failure",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 500 on a transient DB error so CHIP retries", async () => {
    setPaymentResult({ data: null, error: { message: "db down" } });

    const res = await POST(
      makeRequest({
        id: "chip-1",
        status: "paid",
        event_type: "purchase.paid",
      }),
    );

    expect(res.status).toBe(500);
  });

  // ---- Refund events -------------------------------------------------------

  it("settles a refund: correlates payment.refunded via related_to → registration → refund", async () => {
    // related_to → original purchase → registration payment
    setPaymentResult({ data: { registration_id: "reg-1" }, error: null });
    // registration → live refund row
    setRefundResult({ data: { id: "rf-1" }, error: null });

    const res = await POST(
      makeRequest({
        id: "refund-pay-1", // the CHIP refund Payment id
        status: "refunded",
        event_type: "payment.refunded",
        related_to: { id: "chip-orig-1" },
        transaction_data: { payment_method: "fpx_b2c" },
      }),
    );

    expect(res.status).toBe(200);
    // Correlated on the ORIGINAL purchase id, not the refund payment id.
    expect(mockFrom).toHaveBeenCalledWith("payments");
    expect(mockFrom).toHaveBeenCalledWith("refunds");
    expect(mockRpc).toHaveBeenCalledWith("settle_refund", {
      p_refund_id: "rf-1",
      p_chip_refund_id: "refund-pay-1",
      p_paid: true,
      p_payment_method: "fpx_b2c",
    });
  });

  it("resolves related_to given as a URL string", async () => {
    setPaymentResult({ data: { registration_id: "reg-1" }, error: null });
    setRefundResult({ data: { id: "rf-1" }, error: null });

    const res = await POST(
      makeRequest({
        id: "refund-pay-1",
        status: "refunded",
        event_type: "payment.refunded",
        related_to: "https://gate.chip-in.asia/api/v1/purchases/chip-orig-1/",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "settle_refund",
      expect.objectContaining({ p_refund_id: "rf-1", p_paid: true }),
    );
  });

  it("acks a pending_refund without settling", async () => {
    const res = await POST(
      makeRequest({
        id: "chip-orig-1",
        status: "pending_refund",
        event_type: "purchase.pending_refund",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("settles a refund failure with p_paid=false (no ledger row)", async () => {
    // The failure event carries the original Purchase directly (payload.id).
    setPaymentResult({ data: { registration_id: "reg-1" }, error: null });
    setRefundResult({ data: { id: "rf-1" }, error: null });

    const res = await POST(
      makeRequest({
        id: "chip-orig-1",
        status: "error",
        event_type: "purchase.refund_failure",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("settle_refund", {
      p_refund_id: "rf-1",
      p_chip_refund_id: null,
      p_paid: false,
      p_payment_method: null,
    });
  });

  it("acks a refund event with no matching registration payment", async () => {
    setPaymentResult({ data: null, error: null });

    const res = await POST(
      makeRequest({
        id: "refund-pay-1",
        status: "refunded",
        event_type: "payment.refunded",
        related_to: { id: "chip-unknown" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("acks a refund event with no matching refund row (e.g. out-of-band refund)", async () => {
    setPaymentResult({ data: { registration_id: "reg-1" }, error: null });
    setRefundResult({ data: null, error: null });

    const res = await POST(
      makeRequest({
        id: "refund-pay-1",
        status: "refunded",
        event_type: "payment.refunded",
        related_to: { id: "chip-orig-1" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 500 when the refund correlation lookup errors", async () => {
    setPaymentResult({ data: null, error: { message: "db down" } });

    const res = await POST(
      makeRequest({
        id: "refund-pay-1",
        status: "refunded",
        event_type: "payment.refunded",
        related_to: { id: "chip-orig-1" },
      }),
    );

    expect(res.status).toBe(500);
  });
});
