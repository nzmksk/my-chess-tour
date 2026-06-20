import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const {
  mockMaybeSingle,
  mockEq,
  mockSelect,
  mockFrom,
  mockStoreVerificationCode,
  mockStartResendCooldown,
  mockClearResendCooldown,
  mockSendVerificationEmail,
  mockRecordSignupAttempt,
} = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  const mockStoreVerificationCode = vi.fn();
  const mockStartResendCooldown = vi.fn();
  const mockClearResendCooldown = vi.fn();
  const mockSendVerificationEmail = vi.fn();
  const mockRecordSignupAttempt = vi.fn();
  return {
    mockMaybeSingle,
    mockEq,
    mockSelect,
    mockFrom,
    mockStoreVerificationCode,
    mockStartResendCooldown,
    mockClearResendCooldown,
    mockSendVerificationEmail,
    mockRecordSignupAttempt,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/redis/redis", () => ({
  storeVerificationCode: mockStoreVerificationCode,
  startResendCooldown: mockStartResendCooldown,
  clearResendCooldown: mockClearResendCooldown,
  recordSignupAttempt: mockRecordSignupAttempt,
  MAX_SIGNUP_ATTEMPTS_PER_IP: 30,
}));

vi.mock("@/services/email/email", () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/signup/request-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { email: "player@example.com" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/signup/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({
      data: { id: "u1", is_verified: false },
      error: null,
    });
    mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });
    mockStoreVerificationCode.mockResolvedValue(undefined);
    mockStartResendCooldown.mockResolvedValue(0); // not on cooldown
    mockClearResendCooldown.mockResolvedValue(undefined);
    mockSendVerificationEmail.mockResolvedValue(undefined);
    mockRecordSignupAttempt.mockResolvedValue(1); // under the per-IP limit
  });

  // --- Success --------------------------------------------------------------

  it("sends a new code for an existing, unverified account", async () => {
    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/sent/i);
    expect(mockStartResendCooldown).toHaveBeenCalledWith("player@example.com");
    expect(mockStoreVerificationCode).toHaveBeenCalledOnce();
    expect(mockSendVerificationEmail).toHaveBeenCalledOnce();
  });

  // --- Enumeration hardening: every account state looks identical -----------

  it("returns a generic 200 without sending when the account is missing", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(200);
    expect(mockStartResendCooldown).not.toHaveBeenCalled();
    expect(mockStoreVerificationCode).not.toHaveBeenCalled();
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it("returns a generic 200 without sending when already verified", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: "u1", is_verified: true },
      error: null,
    });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(200);
    expect(mockStartResendCooldown).not.toHaveBeenCalled();
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it("returns a generic 200 without sending when on cooldown (never reveals the throttle)", async () => {
    mockStartResendCooldown.mockResolvedValue(900); // 15 min remaining

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(200);
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(mockStoreVerificationCode).not.toHaveBeenCalled();
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it("returns an identical response for missing, verified, and unverified accounts", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const missing = await POST(makeRequest(validBody));
    const missingBody = await missing.json();

    mockMaybeSingle.mockResolvedValue({
      data: { id: "u1", is_verified: true },
      error: null,
    });
    const verified = await POST(makeRequest(validBody));
    const verifiedBody = await verified.json();

    mockMaybeSingle.mockResolvedValue({
      data: { id: "u1", is_verified: false },
      error: null,
    });
    const unverified = await POST(makeRequest(validBody));
    const unverifiedBody = await unverified.json();

    expect(missing.status).toBe(200);
    expect(verified.status).toBe(200);
    expect(unverified.status).toBe(200);
    expect(missingBody).toEqual(verifiedBody);
    expect(verifiedBody).toEqual(unverifiedBody);
  });

  // --- Per-IP rate limiting -------------------------------------------------

  it("returns 429 once the per-IP attempt limit is exceeded", async () => {
    mockRecordSignupAttempt.mockResolvedValue(31); // over the limit of 30

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error.code).toBe("RATE_LIMITED");
    // Throttled before any account lookup or send
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  // --- Send failures (genuine infra errors still surface) -------------------

  it("releases the cooldown and returns 500 when storing the code fails", async () => {
    mockStoreVerificationCode.mockRejectedValue(new Error("Redis down"));

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
    expect(mockClearResendCooldown).toHaveBeenCalledWith("player@example.com");
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it("releases the cooldown and returns 500 when sending the email fails", async () => {
    mockSendVerificationEmail.mockRejectedValue(new Error("SMTP error"));

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
    expect(mockClearResendCooldown).toHaveBeenCalledWith("player@example.com");
  });

  // --- Validation -----------------------------------------------------------

  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.message).toMatch(/email is required/i);
  });

  it("returns 400 for invalid email format", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.message).toMatch(/invalid email format/i);
  });

  it("returns 500 when the user lookup fails", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "DB error" },
    });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
    expect(mockStartResendCooldown).not.toHaveBeenCalled();
  });
});
