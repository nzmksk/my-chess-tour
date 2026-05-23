import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const {
  mockGetVerificationCode,
  mockEq,
  mockUpdate,
  mockFrom,
  mockSignInWithPassword,
} = vi.hoisted(() => {
  const mockGetVerificationCode = vi.fn();
  const mockEq = vi.fn();
  const mockUpdate = vi.fn(() => ({ eq: mockEq }));
  const mockFrom = vi.fn(() => ({ update: mockUpdate }));
  const mockSignInWithPassword = vi.fn();
  return {
    mockGetVerificationCode,
    mockEq,
    mockUpdate,
    mockFrom,
    mockSignInWithPassword,
  };
});

vi.mock("@/services/redis/redis", () => ({
  getVerificationCode: mockGetVerificationCode,
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    from: mockFrom,
  },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithPassword: mockSignInWithPassword,
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
  password: "securepass",
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
    mockEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: null });
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

  it("signs the user in after verification", async () => {
    await POST(makeRequest(validBody));

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "player@example.com",
      password: "securepass",
    });
  });

  it("accepts code match case-insensitively", async () => {
    mockGetVerificationCode.mockResolvedValue("abc123");
    const res = await POST(makeRequest({ ...validBody, code: "ABC123" }));
    expect(res.status).toBe(200);
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

  it("returns 400 when password is missing", async () => {
    const { password: _, ...body } = validBody;
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.message).toMatch(/password is required/i);
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

    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  // --- Sign-in errors -------------------------------------------------------

  it("returns 500 when sign-in fails after verification", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "Sign-in failed" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error.message).toMatch(/failed to sign in/i);
  });
});
