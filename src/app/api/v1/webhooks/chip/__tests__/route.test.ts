import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, setPaymentResult } = vi.hoisted(() => {
  function makeBuilder(getResult: () => unknown) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "maybeSingle"]) {
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

  const mockFrom = vi.fn((table: string) => {
    if (table === "payments")
      return makeBuilder(
        () => paymentResults[idx++] ?? { data: null, error: null },
      );
    return makeBuilder(() => ({ data: null, error: null }));
  });

  const mockRpc = vi.fn<() => Promise<{ data: unknown; error: unknown }>>(() =>
    Promise.resolve({ data: { already_processed: false }, error: null }),
  );
  return { mockFrom, mockRpc, setPaymentResult };
});

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

  it("settles a paid purchase and forwards the charged amount", async () => {
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
      }),
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("settle_registration_payment", {
      p_payment_id: "pay-1",
      p_paid: true,
      p_amount_cents: 5500,
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

  it("acks without settling for a stale, superseded purchase", async () => {
    // chip_transaction_id lookup misses (purchase superseded); reference match
    // returns a payment whose current purchase id differs from the incoming one.
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
    expect(mockRpc).not.toHaveBeenCalled();
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
});
