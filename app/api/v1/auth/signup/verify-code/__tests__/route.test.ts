import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const { mockGetVerificationCode, mockCreateUser, mockEq, mockUpdate, mockFrom } =
  vi.hoisted(() => {
    const mockGetVerificationCode = vi.fn();
    const mockCreateUser = vi.fn();
    const mockEq = vi.fn();
    const mockUpdate = vi.fn(() => ({ eq: mockEq }));
    const mockFrom = vi.fn(() => ({ update: mockUpdate }));
    return { mockGetVerificationCode, mockCreateUser, mockEq, mockUpdate, mockFrom };
  });

vi.mock("@/lib/redis", () => ({
  getVerificationCode: mockGetVerificationCode,
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("$2b$12$mockedhash") },
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: { admin: { createUser: mockCreateUser } },
    from: mockFrom,
  },
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validBody = {
  email: "player@example.com",
  code: "ABC123",
  password: "securepass",
  firstName: "Alice",
  lastName: "Wong",
  gender: "female",
  nationality: "Malaysian",
  dateOfBirth: "1990-01-01",
  state: "Selangor",
  fideId: "",
  mcfId: "",
  isOku: false,
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
    mockCreateUser.mockResolvedValue({
      data: { user: { id: "new-user-id" } },
      error: null,
    });
    mockEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });
  });

  // --- Success --------------------------------------------------------------

  it("returns 201 on valid code and creates user", async () => {
    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.message).toMatch(/account created/i);
  });

  it("calls createUser with email_confirm: true", async () => {
    await POST(makeRequest(validBody));

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "player@example.com",
        email_confirm: true,
      })
    );
  });

  it("includes password_hash in user_metadata", async () => {
    await POST(makeRequest(validBody));

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        user_metadata: expect.objectContaining({
          password_hash: "$2b$12$mockedhash",
          first_name: "Alice",
          last_name: "Wong",
        }),
      })
    );
  });

  it("updates player_profiles with all profile fields", async () => {
    await POST(makeRequest(validBody));

    expect(mockFrom).toHaveBeenCalledWith("player_profiles");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        gender: "female",
        nationality: "Malaysian",
        date_of_birth: "1990-01-01",
        state: "Selangor",
        is_oku: false,
      })
    );
    expect(mockEq).toHaveBeenCalledWith("user_id", "new-user-id");
  });

  it("stores null for empty optional string fields", async () => {
    await POST(makeRequest({ ...validBody, fideId: "", mcfId: "" }));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        fide_id: null,
        mcf_id: null,
      })
    );
  });

  it("defaults is_oku to false when not provided", async () => {
    const { isOku: _, ...bodyWithoutIsOku } = validBody;
    await POST(makeRequest(bodyWithoutIsOku));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ is_oku: false })
    );
  });

  it("accepts code match case-insensitively", async () => {
    mockGetVerificationCode.mockResolvedValue("abc123");
    const res = await POST(makeRequest({ ...validBody, code: "ABC123" }));
    expect(res.status).toBe(201);
  });

  // --- Validation errors ----------------------------------------------------

  it("returns 400 for malformed JSON", async () => {
    const res = await POST(makeInvalidJsonRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/invalid json/i);
  });

  it("returns 400 when email is missing", async () => {
    const { email: _, ...body } = validBody;
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/email is required/i);
  });

  it("returns 400 when code is missing", async () => {
    const { code: _, ...body } = validBody;
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/code is required/i);
  });

  it("returns 400 when password is missing", async () => {
    const { password: _, ...body } = validBody;
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/missing required registration fields/i);
  });

  it("returns 400 when firstName is missing", async () => {
    const { firstName: _, ...body } = validBody;
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/missing required registration fields/i);
  });

  it("returns 400 when lastName is missing", async () => {
    const { lastName: _, ...body } = validBody;
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/missing required registration fields/i);
  });

  // --- Code validation ------------------------------------------------------

  it("returns 410 CODE_EXPIRED when no code in Redis", async () => {
    mockGetVerificationCode.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(410);
    expect(json.code).toBe("CODE_EXPIRED");
  });

  it("returns 422 CODE_INVALID when code does not match", async () => {
    mockGetVerificationCode.mockResolvedValue("ZZZZZZ");

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.code).toBe("CODE_INVALID");
  });

  it("does not call createUser when code is expired", async () => {
    mockGetVerificationCode.mockResolvedValue(null);
    await POST(makeRequest(validBody));
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("does not call createUser when code is wrong", async () => {
    mockGetVerificationCode.mockResolvedValue("ZZZZZZ");
    await POST(makeRequest(validBody));
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  // --- Auth errors ----------------------------------------------------------

  it("returns 409 EMAIL_EXISTS when Supabase reports email_exists code", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "User already registered" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe("EMAIL_EXISTS");
  });

  it("returns 409 EMAIL_EXISTS when error message contains 'already registered'", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { code: "other_code", message: "User already registered" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe("EMAIL_EXISTS");
  });

  it("returns 400 for other auth errors", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected", message: "Something went wrong" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Something went wrong");
  });

  // --- Profile update errors ------------------------------------------------

  it("returns 500 when profile update fails", async () => {
    mockEq.mockResolvedValue({ error: { message: "Profile update failed" } });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toMatch(/failed to save profile/i);
  });
});
