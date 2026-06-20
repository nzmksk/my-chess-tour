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
} = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  const mockStoreVerificationCode = vi.fn();
  const mockStartResendCooldown = vi.fn();
  const mockClearResendCooldown = vi.fn();
  const mockSendVerificationEmail = vi.fn();
  return {
    mockMaybeSingle,
    mockEq,
    mockSelect,
    mockFrom,
    mockStoreVerificationCode,
    mockStartResendCooldown,
    mockClearResendCooldown,
    mockSendVerificationEmail,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/redis/redis", () => ({
  storeVerificationCode: mockStoreVerificationCode,
  startResendCooldown: mockStartResendCooldown,
  clearResendCooldown: mockClearResendCooldown,
}));

vi.mock("@/services/email/email", () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/signup/resend-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { email: "player@example.com" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/signup/resend-code", () => {
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
  });

  // --- Success --------------------------------------------------------------

  it("returns 200 and sends a new code when not on cooldown", async () => {
    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/resent/i);
    expect(mockStartResendCooldown).toHaveBeenCalledWith("player@example.com");
    expect(mockStoreVerificationCode).toHaveBeenCalledOnce();
    expect(mockSendVerificationEmail).toHaveBeenCalledOnce();
  });

  // --- Rate limiting --------------------------------------------------------

  it("returns 429 with Retry-After when still on cooldown", async () => {
    mockStartResendCooldown.mockResolvedValue(900); // 15 min remaining

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(res.headers.get("Retry-After")).toBe("900");
    // No code is stored or emailed while throttled
    expect(mockStoreVerificationCode).not.toHaveBeenCalled();
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it("releases the cooldown when storing the code fails", async () => {
    mockStoreVerificationCode.mockRejectedValue(new Error("Redis down"));

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
    expect(mockClearResendCooldown).toHaveBeenCalledWith("player@example.com");
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it("releases the cooldown when sending the email fails", async () => {
    mockSendVerificationEmail.mockRejectedValue(new Error("SMTP error"));

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
    expect(mockClearResendCooldown).toHaveBeenCalledWith("player@example.com");
  });

  // --- Account state guards (cooldown only applies to valid candidates) -----

  it("returns 404 and never starts a cooldown when the account is missing", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error.code).toBe("NOT_FOUND");
    expect(mockStartResendCooldown).not.toHaveBeenCalled();
  });

  it("returns 409 and never starts a cooldown when already verified", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: "u1", is_verified: true },
      error: null,
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("ALREADY_VERIFIED");
    expect(mockStartResendCooldown).not.toHaveBeenCalled();
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
