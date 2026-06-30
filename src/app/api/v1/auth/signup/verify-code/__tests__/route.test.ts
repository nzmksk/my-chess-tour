import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const {
  mockGetVerificationCode,
  mockDeleteVerificationCode,
  mockGetVerifyAttempts,
  mockRecordVerifyAttempt,
  mockResetVerifyAttempts,
  mockEq,
  mockUpdate,
  mockFrom,
  mockGenerateLink,
  mockVerifyOtp,
} = vi.hoisted(() => {
  const mockGetVerificationCode = vi.fn();
  const mockDeleteVerificationCode = vi.fn();
  const mockGetVerifyAttempts = vi.fn();
  const mockRecordVerifyAttempt = vi.fn();
  const mockResetVerifyAttempts = vi.fn();
  const mockEq = vi.fn();
  const mockUpdate = vi.fn(() => ({ eq: mockEq }));
  const mockFrom = vi.fn(() => ({ update: mockUpdate }));
  const mockGenerateLink = vi.fn();
  const mockVerifyOtp = vi.fn();
  return {
    mockGetVerificationCode,
    mockDeleteVerificationCode,
    mockGetVerifyAttempts,
    mockRecordVerifyAttempt,
    mockResetVerifyAttempts,
    mockEq,
    mockUpdate,
    mockFrom,
    mockGenerateLink,
    mockVerifyOtp,
  };
});

vi.mock("@/services/redis/redis", () => ({
  getVerificationCode: mockGetVerificationCode,
  deleteVerificationCode: mockDeleteVerificationCode,
  getVerifyAttempts: mockGetVerifyAttempts,
  recordVerifyAttempt: mockRecordVerifyAttempt,
  resetVerifyAttempts: mockResetVerifyAttempts,
  MAX_VERIFY_ATTEMPTS: 5,
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    from: mockFrom,
    auth: {
      admin: {
        generateLink: mockGenerateLink,
      },
    },
  },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      verifyOtp: mockVerifyOtp,
    },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validBody = {
  email: "player@example.com",
  code: "ABC123",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/signup/verify-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/signup/verify-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not valid json",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/signup/verify-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVerificationCode.mockResolvedValue("ABC123");
    mockDeleteVerificationCode.mockResolvedValue(undefined);
    mockGetVerifyAttempts.mockResolvedValue(0);
    mockRecordVerifyAttempt.mockResolvedValue(1);
    mockResetVerifyAttempts.mockResolvedValue(undefined);
    mockEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hashed-token-123" } },
      error: null,
    });
    mockVerifyOtp.mockResolvedValue({ data: {}, error: null });
  });

  // --- Success --------------------------------------------------------------

  it("returns 200 on valid code and updates verified status", async () => {
    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/verified/i);
  });

  it("updates is_verified and verified_at in users table", async () => {
    await POST(makeRequest(validBody));

    expect(mockFrom).toHaveBeenCalledWith("users");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        is_verified: true,
        verified_at: expect.any(String),
      }),
    );
    expect(mockEq).toHaveBeenCalledWith("email", "player@example.com");
  });

  it("mints a session server-side after verification without a password", async () => {
    await POST(makeRequest(validBody));

    expect(mockGenerateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "player@example.com",
    });
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      type: "magiclink",
      token_hash: "hashed-token-123",
    });
  });

  it("accepts code match case-insensitively", async () => {
    mockGetVerificationCode.mockResolvedValue("abc123");
    const res = await POST(makeRequest({ ...validBody, code: "ABC123" }));
    expect(res.status).toBe(200);
  });

  it("clears the signup step cookie on success", async () => {
    const res = await POST(makeRequest(validBody));
    const cookie = res.cookies.get("signup_step");

    // The cookie is deleted (value emptied) — the user is verified, signed in,
    // and redirected straight into the app.
    expect(cookie?.value).toBe("");
  });

  // --- Validation errors ----------------------------------------------------

  it("returns 400 for malformed JSON", async () => {
    const res = await POST(makeInvalidJsonRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.message).toMatch(/invalid json/i);
  });

  it("returns 400 when email is missing", async () => {
    const { email: _, ...body } = validBody;
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.message).toMatch(/email is required/i);
  });

  it("returns 400 when code is missing", async () => {
    const { code: _, ...body } = validBody;
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.message).toMatch(/code is required/i);
  });

  // --- Code validation ------------------------------------------------------

  it("returns 410 CODE_EXPIRED when no code in Redis", async () => {
    mockGetVerificationCode.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(410);
    expect(json.error.code).toBe("CODE_EXPIRED");
  });

  it("returns 422 CODE_INVALID when code does not match", async () => {
    mockGetVerificationCode.mockResolvedValue("ZZZZZZ");

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("CODE_INVALID");
  });

  // --- Brute-force rate limiting --------------------------------------------

  it("resets the failed-attempt counter on successful verification", async () => {
    await POST(makeRequest(validBody));
    expect(mockResetVerifyAttempts).toHaveBeenCalledWith("player@example.com");
  });

  it("consumes (deletes) the code on successful verification", async () => {
    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(200);
    expect(mockDeleteVerificationCode).toHaveBeenCalledWith(
      "player@example.com",
    );
  });

  it("does not consume the code on a wrong code", async () => {
    mockGetVerificationCode.mockResolvedValue("ZZZZZZ");
    await POST(makeRequest(validBody));
    expect(mockDeleteVerificationCode).not.toHaveBeenCalled();
  });

  it("still returns 200 if consuming the code fails", async () => {
    mockDeleteVerificationCode.mockRejectedValue(new Error("Redis down"));

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(200);
  });

  it("records a failed attempt and reports remaining tries on wrong code", async () => {
    mockGetVerificationCode.mockResolvedValue("ZZZZZZ");
    mockRecordVerifyAttempt.mockResolvedValue(2); // 2 of 5 used

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("CODE_INVALID");
    expect(json.error.message).toMatch(/3 attempts remaining/i);
    expect(mockRecordVerifyAttempt).toHaveBeenCalledWith("player@example.com");
  });

  it("returns 429 when the wrong code reaches the attempt limit", async () => {
    mockGetVerificationCode.mockResolvedValue("ZZZZZZ");
    mockRecordVerifyAttempt.mockResolvedValue(5); // 5th and final attempt

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("returns 429 before checking the code once already locked out", async () => {
    mockGetVerifyAttempts.mockResolvedValue(5);

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error.code).toBe("TOO_MANY_ATTEMPTS");
    // Should not even look at the stored code or sign the user in
    expect(mockGetVerificationCode).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it("does not update users table when code is expired", async () => {
    mockGetVerificationCode.mockResolvedValue(null);
    await POST(makeRequest(validBody));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("does not update users table when code is wrong", async () => {
    mockGetVerificationCode.mockResolvedValue("ZZZZZZ");
    await POST(makeRequest(validBody));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // --- Update errors --------------------------------------------------------

  it("returns 500 when users table update fails", async () => {
    mockEq.mockResolvedValue({ error: { message: "Update failed" } });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error.message).toMatch(/failed to verify account/i);
  });

  it("does not sign in when users table update fails", async () => {
    mockEq.mockResolvedValue({ error: { message: "Update failed" } });

    await POST(makeRequest(validBody));

    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  // --- Sign-in errors -------------------------------------------------------

  it("returns 500 when session link generation fails after verification", async () => {
    mockGenerateLink.mockResolvedValue({
      data: {},
      error: { message: "Link generation failed" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error.message).toMatch(/failed to sign in/i);
  });

  it("returns 500 when the OTP session exchange fails after verification", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {},
      error: { message: "Sign-in failed" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error.message).toMatch(/failed to sign in/i);
  });
});
