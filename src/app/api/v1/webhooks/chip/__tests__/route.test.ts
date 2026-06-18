import { generateKeyPairSync, createSign } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// RSA key pair used across all signature tests
const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } =
  generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockPaymentsBuilder,
  mockRegistrationsBuilder,
  mockFrom,
  mockRedisDel,
} = vi.hoisted(() => {
  function makeBuilder(result: { data?: unknown; error?: unknown }) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "update", "single", "maybeSingle"]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) => Promise.resolve(result).then(onfulfilled, onrejected);
    return b;
  }

  const mockPaymentsBuilder = makeBuilder({ data: null, error: null });
  const mockRegistrationsBuilder = makeBuilder({ data: null, error: null });
  const mockRedisDel = vi.fn().mockResolvedValue(1);

  const mockFrom = vi.fn((table: string) => {
    if (table === "payments") return mockPaymentsBuilder;
    if (table === "registrations") return mockRegistrationsBuilder;
    return mockPaymentsBuilder;
  });

  return {
    mockPaymentsBuilder,
    mockRegistrationsBuilder,
    mockFrom,
    mockRedisDel,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/redis/redis", () => ({
  redis: { del: mockRedisDel },
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAYMENT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const REGISTRATION_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const USER_ID = "cccccccc-0000-0000-0000-000000000003";

function makeSignature(body: string, privKey = TEST_PRIVATE_KEY): string {
  return createSign("SHA256").update(body).sign(privKey, "base64");
}

function makePayload(status: string, referenceId = PAYMENT_ID): string {
  return JSON.stringify({
    id: "chip-purchase-xyz",
    status,
    reference_id: referenceId,
  });
}

function makeRequest(body: string, signature?: string): NextRequest {
  return new NextRequest("http://localhost/api/v1/webhooks/chip", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature !== undefined ? { "x-signature": signature } : {}),
    },
    body,
  });
}

function setPaymentResult(
  data: unknown,
  error: unknown = null,
  builder = mockPaymentsBuilder,
) {
  (builder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setRegistrationResult(data: unknown, error: unknown = null) {
  (mockRegistrationsBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) =>
    Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

const PENDING_PAYMENT = {
  id: PAYMENT_ID,
  registration_id: REGISTRATION_ID,
  user_id: USER_ID,
  status: "pending",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/webhooks/chip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CHIP_WEBHOOK_PUBLIC_KEY", TEST_PUBLIC_KEY);
    setPaymentResult(PENDING_PAYMENT);
    setRegistrationResult(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Signature verification
  // -------------------------------------------------------------------------

  describe("signature verification", () => {
    it("returns 401 when x-signature header is missing", async () => {
      const body = makePayload("paid");
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(json.error.message).toMatch(/missing signature/i);
    });

    it("returns 401 when signature is invalid", async () => {
      const body = makePayload("paid");
      const res = await POST(makeRequest(body, "bad-signature-value"));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(json.error.message).toMatch(/invalid signature/i);
    });

    it("returns 500 when CHIP_WEBHOOK_PUBLIC_KEY is not set", async () => {
      vi.stubEnv("CHIP_WEBHOOK_PUBLIC_KEY", "");
      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("accepts a valid RSA signature", async () => {
      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).not.toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Event filtering
  // -------------------------------------------------------------------------

  describe("event filtering", () => {
    it("returns 200 and does nothing for unknown status values", async () => {
      const body = makePayload("pending");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("returns 200 for cancelled status without DB update", async () => {
      const body = makePayload("cancelled");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(200);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("processes paid status", async () => {
      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(200);
      expect(mockFrom).toHaveBeenCalledWith("payments");
    });

    it("processes payment_failed status", async () => {
      const body = makePayload("payment_failed");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(200);
      expect(mockFrom).toHaveBeenCalledWith("payments");
    });
  });

  // -------------------------------------------------------------------------
  // Request body validation
  // -------------------------------------------------------------------------

  describe("body validation", () => {
    it("returns 400 for invalid JSON body", async () => {
      const body = "not-json{";
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // Payment lookup
  // -------------------------------------------------------------------------

  describe("payment lookup", () => {
    it("returns 404 when payment is not found", async () => {
      setPaymentResult(null, { code: "PGRST116", message: "not found" });
      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 200 when payment is already paid (idempotent)", async () => {
      setPaymentResult({ ...PENDING_PAYMENT, status: "paid" });
      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
    });

    it("returns 200 when payment is already failed (idempotent)", async () => {
      setPaymentResult({ ...PENDING_PAYMENT, status: "failed" });
      const body = makePayload("payment_failed");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Payment status update on paid
  // -------------------------------------------------------------------------

  describe("paid event processing", () => {
    it("updates payment status to paid", async () => {
      const body = makePayload("paid");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));

      const updateMock = mockPaymentsBuilder.update as ReturnType<typeof vi.fn>;
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "paid" }),
      );
    });

    it("sets paid_at timestamp when paid", async () => {
      const body = makePayload("paid");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));

      const updateMock = mockPaymentsBuilder.update as ReturnType<typeof vi.fn>;
      const [updateArg] = updateMock.mock.calls[0];
      expect(updateArg).toHaveProperty("paid_at");
      expect(typeof updateArg.paid_at).toBe("string");
    });

    it("updates registration status to confirmed", async () => {
      const body = makePayload("paid");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));

      const updateMock = mockRegistrationsBuilder.update as ReturnType<
        typeof vi.fn
      >;
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "confirmed" }),
      );
    });

    it("sets confirmed_at timestamp on registration when paid", async () => {
      const body = makePayload("paid");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));

      const updateMock = mockRegistrationsBuilder.update as ReturnType<
        typeof vi.fn
      >;
      const [updateArg] = updateMock.mock.calls[0];
      expect(updateArg).toHaveProperty("confirmed_at");
      expect(typeof updateArg.confirmed_at).toBe("string");
    });

    it("invalidates the registrations Redis cache for the user", async () => {
      const body = makePayload("paid");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));

      expect(mockRedisDel).toHaveBeenCalledWith(`registrations:${USER_ID}`);
    });

    it("returns 200 with received: true", async () => {
      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Payment status update on payment_failed
  // -------------------------------------------------------------------------

  describe("payment_failed event processing", () => {
    it("updates payment status to failed", async () => {
      const body = makePayload("payment_failed");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));

      const updateMock = mockPaymentsBuilder.update as ReturnType<typeof vi.fn>;
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed" }),
      );
    });

    it("sets paid_at to null when payment fails", async () => {
      const body = makePayload("payment_failed");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));

      const updateMock = mockPaymentsBuilder.update as ReturnType<typeof vi.fn>;
      const [updateArg] = updateMock.mock.calls[0];
      expect(updateArg.paid_at).toBeNull();
    });

    it("updates registration status to failed_payment", async () => {
      const body = makePayload("payment_failed");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));

      const updateMock = mockRegistrationsBuilder.update as ReturnType<
        typeof vi.fn
      >;
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed_payment" }),
      );
    });

    it("sets confirmed_at to null when payment fails", async () => {
      const body = makePayload("payment_failed");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));

      const updateMock = mockRegistrationsBuilder.update as ReturnType<
        typeof vi.fn
      >;
      const [updateArg] = updateMock.mock.calls[0];
      expect(updateArg.confirmed_at).toBeNull();
    });

    it("invalidates the registrations Redis cache for the user", async () => {
      const body = makePayload("payment_failed");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));

      expect(mockRedisDel).toHaveBeenCalledWith(`registrations:${USER_ID}`);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("returns 500 when payment update fails", async () => {
      setPaymentResult(PENDING_PAYMENT);

      // payment update returns error
      (mockPaymentsBuilder as Record<string, unknown>).then = vi.fn(
        (onfulfilled: (v: unknown) => unknown) => {
          let callCount = 0;
          return {
            then: (fn: (v: unknown) => unknown) => {
              callCount++;
              if (callCount === 1)
                return Promise.resolve({ data: PENDING_PAYMENT, error: null }).then(fn);
              return Promise.resolve({
                data: null,
                error: { message: "DB write error" },
              }).then(fn);
            },
          };
        },
      );

      // Re-set so first call (select) returns data, second call (update) returns error
      let callCount = 0;
      (mockPaymentsBuilder as Record<string, unknown>).then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) => {
        callCount++;
        const result =
          callCount === 1
            ? { data: PENDING_PAYMENT, error: null }
            : { data: null, error: { message: "DB write error" } };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      };

      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when registration update fails", async () => {
      setRegistrationResult(null, { message: "registration write error" });
      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("does not invalidate Redis cache when registration update fails", async () => {
      setRegistrationResult(null, { message: "registration write error" });
      const body = makePayload("paid");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));
      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    it("skips Redis del when user_id is null", async () => {
      setPaymentResult({ ...PENDING_PAYMENT, user_id: null });
      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(200);
      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    it("skips registration update when registration_id is null", async () => {
      setPaymentResult({ ...PENDING_PAYMENT, registration_id: null });
      const body = makePayload("paid");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));
      const updateMock = mockRegistrationsBuilder.update as ReturnType<
        typeof vi.fn
      >;
      expect(updateMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Idempotent retry recovery
  // -------------------------------------------------------------------------

  describe("idempotent retry recovery", () => {
    it("retries registration update when payment is already paid", async () => {
      setPaymentResult({ ...PENDING_PAYMENT, status: "paid" });
      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(200);
      const updateMock = mockRegistrationsBuilder.update as ReturnType<
        typeof vi.fn
      >;
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "confirmed" }),
      );
    });

    it("retries registration update when payment is already failed", async () => {
      setPaymentResult({ ...PENDING_PAYMENT, status: "failed" });
      const body = makePayload("payment_failed");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(200);
      const updateMock = mockRegistrationsBuilder.update as ReturnType<
        typeof vi.fn
      >;
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed_payment" }),
      );
    });

    it("returns 500 on retry when registration recovery update fails", async () => {
      setPaymentResult({ ...PENDING_PAYMENT, status: "paid" });
      setRegistrationResult(null, { message: "recovery write error" });
      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("skips registration update on retry when registration_id is null", async () => {
      setPaymentResult({
        ...PENDING_PAYMENT,
        status: "paid",
        registration_id: null,
      });
      const body = makePayload("paid");
      const sig = makeSignature(body);
      const res = await POST(makeRequest(body, sig));
      expect(res.status).toBe(200);
      const updateMock = mockRegistrationsBuilder.update as ReturnType<
        typeof vi.fn
      >;
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("invalidates Redis cache on successful recovery retry", async () => {
      setPaymentResult({ ...PENDING_PAYMENT, status: "paid" });
      const body = makePayload("paid");
      const sig = makeSignature(body);
      await POST(makeRequest(body, sig));
      expect(mockRedisDel).toHaveBeenCalledWith(`registrations:${USER_ID}`);
    });
  });
});
