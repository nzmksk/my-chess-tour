import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFrom, lookups, mockSettle, eqCalls } = vi.hoisted(() => {
  const lookups: Array<{ data: unknown; error: unknown }> = [];
  const eqCalls: Array<[string, unknown]> = [];

  function makeBuilder() {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "maybeSingle"]) {
      b[m] = vi.fn(() => b);
    }
    b.eq = vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return b;
    });
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) =>
      Promise.resolve(lookups.shift() ?? { data: null, error: null }).then(
        onfulfilled,
        onrejected,
      );
    return b;
  }

  return {
    lookups,
    eqCalls,
    mockFrom: vi.fn(() => makeBuilder()),
    mockSettle: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/payouts/bank-account", () => ({
  settleBankAccountVerification: mockSettle,
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BANK_ID = "22222222-2222-4222-8222-222222222222";

function rsaKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

// The webhook's key pair: CHIP holds the private half, we get `public_key`.
const { publicKey, privateKey } = rsaKeyPair();

// What CHIP sends: base64 RSA PKCS#1 v1.5 over the SHA-512 of the raw body.
function sign(body: string, key: string = privateKey, algorithm = "sha512"): string {
  return crypto.sign(algorithm, Buffer.from(body), key).toString("base64");
}

function makeRequest(payload: unknown, signature?: string | null) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sig = signature === undefined ? sign(body) : signature;
  if (sig !== null) headers["x-signature"] = sig;
  return new NextRequest("http://localhost/api/v1/webhooks/chip/send", {
    method: "POST",
    headers,
    body,
  });
}

const verifiedEvent = {
  event_type: "bank_account.verified",
  id: 84,
  reference: BANK_ID,
  status: "verified",
  rejection_reason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  lookups.length = 0;
  eqCalls.length = 0;
  vi.stubEnv("CHIP_SEND_WEBHOOK_PUBLIC_KEY", publicKey);
  mockSettle.mockResolvedValue({ error: null, settled: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

describe("signature verification", () => {
  it("processes a validly signed delivery", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    const res = await POST(makeRequest(verifiedEvent));
    expect(res.status).toBe(200);
    expect(mockSettle).toHaveBeenCalledWith({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
      reason: null,
    });
  });

  it("returns 200 WITHOUT processing on a bad signature (not 401)", async () => {
    const res = await POST(makeRequest(verifiedEvent, sign("other body")));
    expect(res.status).toBe(200);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("rejects a signature from a different key (e.g. another webhook's)", async () => {
    const body = JSON.stringify(verifiedEvent);
    const other = rsaKeyPair();
    const res = await POST(makeRequest(body, sign(body, other.privateKey)));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("rejects a Collect-style RSA-SHA256 signature", async () => {
    const body = JSON.stringify(verifiedEvent);
    const res = await POST(makeRequest(body, sign(body, privateKey, "sha256")));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("rejects a hex HMAC-SHA512 signature (the scheme CHIP does NOT use)", async () => {
    const body = JSON.stringify(verifiedEvent);
    const hmac = crypto.createHmac("sha512", "any-secret").update(body).digest("hex");
    const res = await POST(makeRequest(body, hmac));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["too short", "abcd"],
    ["not base64", "not base64!"],
    ["valid base64, wrong length", Buffer.from("abcd").toString("base64")],
  ])("a %s header does not throw and is ignored", async (_label, sig) => {
    const res = await POST(makeRequest(verifiedEvent, sig));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("signs the raw bytes: re-serialised JSON does not verify", async () => {
    const body = JSON.stringify(verifiedEvent);
    const reformatted = JSON.stringify(verifiedEvent, null, 2);
    const res = await POST(makeRequest(reformatted, sign(body)));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("accepts a key stored quoted with literal \\n (Netlify-style)", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    vi.stubEnv(
      "CHIP_SEND_WEBHOOK_PUBLIC_KEY",
      `"${publicKey.trim().replace(/\n/g, "\\n")}"`,
    );
    const res = await POST(makeRequest(verifiedEvent));
    expect(res.status).toBe(200);
    expect(mockSettle).toHaveBeenCalled();
  });

  it("returns 500 when the public key is not configured, so CHIP retries", async () => {
    vi.stubEnv("CHIP_SEND_WEBHOOK_PUBLIC_KEY", "");
    const res = await POST(makeRequest(verifiedEvent));
    expect(res.status).toBe(500);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("returns 500 when the public key is not a valid PEM, so CHIP retries", async () => {
    vi.stubEnv(
      "CHIP_SEND_WEBHOOK_PUBLIC_KEY",
      "-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----",
    );
    const res = await POST(makeRequest(verifiedEvent));
    expect(res.status).toBe(500);
    expect(mockSettle).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bank account events
// ---------------------------------------------------------------------------

describe("bank account events", () => {
  it("correlates on reference first", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(makeRequest(verifiedEvent));
    expect(eqCalls[0]).toEqual(["id", BANK_ID]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("falls back to chip_bank_account_id when reference is unknown", async () => {
    lookups.push({ data: null, error: null }); // reference miss
    lookups.push({ data: { id: BANK_ID }, error: null }); // chip id hit
    await POST(makeRequest(verifiedEvent));
    expect(eqCalls[1]).toEqual(["chip_bank_account_id", 84]);
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ bankAccountId: BANK_ID }),
    );
  });

  it("falls back to chip id when reference is not one of ours", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(makeRequest({ ...verifiedEvent, reference: "VENDOR-001" }));
    expect(eqCalls[0]).toEqual(["chip_bank_account_id", 84]);
    expect(mockSettle).toHaveBeenCalled();
  });

  it("settles a rejection with CHIP's reason", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(
      makeRequest({
        event_type: "bank_account.rejected",
        id: 84,
        reference: BANK_ID,
        status: "rejected",
        rejection_reason: "Account closed",
      }),
    );
    expect(mockSettle).toHaveBeenCalledWith({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: false,
      reason: "Account closed",
    });
  });

  it("understands a status-topic delivery with the resource under data", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(
      makeRequest({
        event: "bank_account_status",
        data: { id: "84", reference: BANK_ID, status: "verified" },
      }),
    );
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ chipBankAccountId: 84, verified: true }),
    );
  });

  it("acks a pending status without touching the DB", async () => {
    const res = await POST(
      makeRequest({ event_type: "bank_account_status", id: 84, status: "pending" }),
    );
    expect(res.status).toBe(200);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("acks an unknown reference without settling", async () => {
    lookups.push({ data: null, error: null });
    lookups.push({ data: null, error: null });
    const res = await POST(makeRequest(verifiedEvent));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("returns 500 when the lookup fails, so CHIP re-delivers", async () => {
    lookups.push({ data: null, error: { message: "db down" } });
    const res = await POST(makeRequest(verifiedEvent));
    expect(res.status).toBe(500);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("returns 500 when settlement fails with a DB error", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    mockSettle.mockResolvedValue({
      error: { code: "40001", message: "serialization failure" },
      settled: false,
    });
    const res = await POST(makeRequest(verifiedEvent));
    expect(res.status).toBe(500);
  });

  it("acks when the row vanished before settlement (P0002)", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    mockSettle.mockResolvedValue({
      error: { code: "P0002", message: "not found" },
      settled: false,
    });
    const res = await POST(makeRequest(verifiedEvent));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

describe("other deliveries", () => {
  it("acks a send-instruction event with no state change", async () => {
    const res = await POST(
      makeRequest({ event_type: "send_instruction.completed", id: 8, state: "completed" }),
    );
    expect(res.status).toBe(200);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("acks a signed but non-JSON body", async () => {
    const res = await POST(makeRequest("not json"));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });
});
