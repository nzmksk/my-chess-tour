import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const {
  mockMaybeSingle,
  mockSelectEq,
  mockSelect,
  mockDeleteEq,
  mockDelete,
  mockFrom,
  mockCreateUser,
  mockDeleteUser,
  mockStoreVerificationCode,
  mockSendVerificationEmail,
} = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  const mockSelectEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));
  const mockDeleteEq = vi.fn();
  const mockDelete = vi.fn(() => ({ eq: mockDeleteEq }));
  const mockFrom = vi.fn(() => ({ select: mockSelect, delete: mockDelete }));
  const mockCreateUser = vi.fn();
  const mockDeleteUser = vi.fn();
  const mockStoreVerificationCode = vi.fn();
  const mockSendVerificationEmail = vi.fn();
  return {
    mockMaybeSingle,
    mockSelectEq,
    mockSelect,
    mockDeleteEq,
    mockDelete,
    mockFrom,
    mockCreateUser,
    mockDeleteUser,
    mockStoreVerificationCode,
    mockSendVerificationEmail,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    from: mockFrom,
    auth: { admin: { createUser: mockCreateUser, deleteUser: mockDeleteUser } },
  },
}));

vi.mock("@/services/redis/redis", () => ({
  storeVerificationCode: mockStoreVerificationCode,
}));

vi.mock("@/services/email/email", () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const validBody = {
  email: "player@example.com",
  password: "Password1!",
  firstName: "Ahmad",
  lastName: "Razif",
};

const NEW_USER_ID = "new-user-id";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/signup/create-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/signup/create-account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No existing user by default
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSelectEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
    mockSelect.mockReturnValue({ eq: mockSelectEq });
    mockDeleteEq.mockResolvedValue({ error: null });
    mockDelete.mockReturnValue({ eq: mockDeleteEq });
    mockFrom.mockReturnValue({ select: mockSelect, delete: mockDelete });
    mockCreateUser.mockResolvedValue({
      data: { user: { id: NEW_USER_ID } },
      error: null,
    });
    mockDeleteUser.mockResolvedValue({ error: null });
    mockStoreVerificationCode.mockResolvedValue(undefined);
    mockSendVerificationEmail.mockResolvedValue(undefined);
  });

  // --- Success --------------------------------------------------------------

  it("returns 201 and sets the signup_step=verify cookie", async () => {
    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.message).toMatch(/account created/i);
    expect(res.cookies.get("signup_step")?.value).toBe("verify");
  });

  it("does not roll back the account on success", async () => {
    await POST(makeRequest(validBody));

    expect(mockStoreVerificationCode).toHaveBeenCalledOnce();
    expect(mockSendVerificationEmail).toHaveBeenCalledOnce();
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("passes the plaintext password to Supabase Auth and never stores a hash in metadata", async () => {
    await POST(makeRequest(validBody));

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "player@example.com",
        password: "Password1!",
        user_metadata: expect.not.objectContaining({
          password_hash: expect.anything(),
        }),
      }),
    );
  });

  // --- Password complexity (server-side) ------------------------------------

  it("rejects a password that is too short", async () => {
    const res = await POST(makeRequest({ ...validBody, password: "Ab1!" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("rejects a long password missing a symbol", async () => {
    const res = await POST(
      makeRequest({ ...validBody, password: "Password1" }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("rejects a password missing an uppercase letter", async () => {
    const res = await POST(
      makeRequest({ ...validBody, password: "password1!" }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  // --- Rollback on post-creation failures -----------------------------------

  it("rolls back the account when storing the code fails", async () => {
    mockStoreVerificationCode.mockRejectedValue(new Error("Redis down"));

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error.message).toMatch(/failed to store verification code/i);

    // public.users row deleted (cascades player_profiles) AND auth user deleted
    expect(mockDelete).toHaveBeenCalledOnce();
    expect(mockDeleteEq).toHaveBeenCalledWith("id", NEW_USER_ID);
    expect(mockDeleteUser).toHaveBeenCalledWith(NEW_USER_ID);

    // Don't leave a step cookie on a failed signup
    expect(res.cookies.get("signup_step")).toBeUndefined();
  });

  it("rolls back the account when sending the email fails", async () => {
    mockSendVerificationEmail.mockRejectedValue(new Error("SMTP error"));

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error.message).toMatch(/failed to send verification email/i);

    expect(mockDelete).toHaveBeenCalledOnce();
    expect(mockDeleteEq).toHaveBeenCalledWith("id", NEW_USER_ID);
    expect(mockDeleteUser).toHaveBeenCalledWith(NEW_USER_ID);
  });

  it("still returns 500 even if rollback itself fails", async () => {
    mockSendVerificationEmail.mockRejectedValue(new Error("SMTP error"));
    mockDeleteEq.mockResolvedValue({ error: { message: "delete failed" } });
    mockDeleteUser.mockResolvedValue({ error: { message: "delete failed" } });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
    expect(mockDeleteUser).toHaveBeenCalledWith(NEW_USER_ID);
  });

  // --- No rollback when nothing was created ---------------------------------

  it("returns 409 and does not roll back when email already exists (pre-check)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: "existing-user" },
      error: null,
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("EMAIL_EXISTS");
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 500 and does not roll back when auth user creation fails", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_failure", message: "boom" },
    });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
    expect(mockStoreVerificationCode).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
