import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const {
  mockRpc,
  mockDeleteEq,
  mockDelete,
  mockFrom,
  mockCreateUser,
  mockDeleteUser,
  mockStoreVerificationCode,
  mockSendVerificationEmail,
  mockHitWindow,
} = vi.hoisted(() => {
  const mockRpc = vi.fn();
  const mockDeleteEq = vi.fn();
  const mockDelete = vi.fn(() => ({ eq: mockDeleteEq }));
  const mockFrom = vi.fn(() => ({ delete: mockDelete }));
  const mockCreateUser = vi.fn();
  const mockDeleteUser = vi.fn();
  const mockStoreVerificationCode = vi.fn();
  const mockSendVerificationEmail = vi.fn();
  const mockHitWindow = vi.fn();
  return {
    mockRpc,
    mockDeleteEq,
    mockDelete,
    mockFrom,
    mockCreateUser,
    mockDeleteUser,
    mockStoreVerificationCode,
    mockSendVerificationEmail,
    mockHitWindow,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    from: mockFrom,
    rpc: mockRpc,
    auth: { admin: { createUser: mockCreateUser, deleteUser: mockDeleteUser } },
  },
}));

vi.mock("@/services/redis/redis", () => ({
  storeVerificationCode: mockStoreVerificationCode,
}));

vi.mock("@/services/rate-limit/window", () => ({
  hitWindow: mockHitWindow,
}));

vi.mock("@/services/email/email", () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

import { POST } from "../route";
import { TERMS_VERSION } from "@/lib/reference/legal";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const validBody = {
  email: "player@example.com",
  password: "Password1!",
  firstName: "Ahmad",
  lastName: "Razif",
  termsAccepted: true,
  dateOfBirth: "1990-05-17",
};

const NEW_USER_ID = "new-user-id";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/signup/create-account", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nf-client-connection-ip": "203.0.113.7",
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/signup/create-account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: false, error: null });
    mockDeleteEq.mockResolvedValue({ error: null });
    mockDelete.mockReturnValue({ eq: mockDeleteEq });
    mockFrom.mockReturnValue({ delete: mockDelete });
    mockCreateUser.mockResolvedValue({
      data: { user: { id: NEW_USER_ID } },
      error: null,
    });
    mockDeleteUser.mockResolvedValue({ error: null });
    mockStoreVerificationCode.mockResolvedValue(undefined);
    mockSendVerificationEmail.mockResolvedValue(undefined);
    mockHitWindow.mockResolvedValue(0); // under the per-IP limit
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

  // --- Terms acceptance -----------------------------------------------------

  it("records the accepted terms version from the server constant", async () => {
    await POST(makeRequest(validBody));

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        user_metadata: expect.objectContaining({
          terms_version: TERMS_VERSION,
        }),
      }),
    );
  });

  it("ignores a terms version supplied in the request body", async () => {
    // A client-supplied version is not evidence of anything — whatever the body
    // claims, the recorded version must be the server's own constant.
    await POST(
      makeRequest({
        ...validBody,
        terms_version: "1999-01-01",
        termsVersion: "1999-01-01",
      }),
    );

    const metadata = mockCreateUser.mock.calls[0][0].user_metadata;
    expect(metadata.terms_version).toBe(TERMS_VERSION);
    expect(JSON.stringify(metadata)).not.toContain("1999-01-01");
  });

  it("rejects a signup that does not accept the terms", async () => {
    for (const termsAccepted of [undefined, false, "true", 1]) {
      vi.clearAllMocks();
      const res = await POST(makeRequest({ ...validBody, termsAccepted }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/must accept the terms/i);
      expect(mockCreateUser).not.toHaveBeenCalled();
    }
  });

  it("rejects a signup without a valid date of birth", async () => {
    for (const dateOfBirth of [
      undefined,
      "",
      19900517,
      "1990-02-30",
      "17/05/1990",
      "2999-01-01",
      "1800-01-01",
    ]) {
      vi.clearAllMocks();
      const res = await POST(makeRequest({ ...validBody, dateOfBirth }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/date of birth/i);
      expect(mockCreateUser).not.toHaveBeenCalled();
    }
  });

  it("refuses an under-18 date of birth with 422 UNDER_18", async () => {
    const tenYearsAgo = new Date().getUTCFullYear() - 10;
    const res = await POST(
      makeRequest({ ...validBody, dateOfBirth: `${tenYearsAgo}-01-01` }),
    );
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("UNDER_18");
    expect(json.error.message).toMatch(/18 or over/);
    expect(json.error.message).toMatch(/parent or guardian/);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("passes the date of birth to handle_new_user", async () => {
    await POST(makeRequest(validBody));

    const metadata = mockCreateUser.mock.calls[0][0].user_metadata;
    expect(metadata.date_of_birth).toBe("1990-05-17");
    expect(metadata).not.toHaveProperty("adult_confirmed");
  });

  // --- Per-IP rate limiting (anti-enumeration) ------------------------------

  it("returns 429 once the per-IP attempt limit is exceeded", async () => {
    mockHitWindow.mockResolvedValue(480); // over the limit, 8 minutes left

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(mockHitWindow).toHaveBeenCalledWith(
      "ratelimit:signup:ip:203.0.113.7",
      30,
      600,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("480");
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(mockCreateUser).not.toHaveBeenCalled();
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

  // --- Field validation -----------------------------------------------------

  it("rejects a missing first name", async () => {
    const res = await POST(makeRequest({ ...validBody, firstName: "" }));
    expect(res.status).toBe(400);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("rejects a missing last name", async () => {
    const res = await POST(makeRequest({ ...validBody, lastName: "" }));
    expect(res.status).toBe(400);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid email format", async () => {
    const res = await POST(
      makeRequest({ ...validBody, email: "not-an-email" }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.message).toMatch(/invalid email/i);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("rejects a first name with invalid characters", async () => {
    const res = await POST(
      makeRequest({ ...validBody, firstName: "Ahmad123" }),
    );
    expect(res.status).toBe(400);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("accepts a/l and a/p in a last name", async () => {
    const res = await POST(
      makeRequest({ ...validBody, firstName: "Muthu", lastName: "a/l Rajan" }),
    );
    expect(res.status).not.toBe(400);
    expect(mockCreateUser).toHaveBeenCalled();
  });

  it("rejects a last name with invalid characters", async () => {
    const res = await POST(makeRequest({ ...validBody, lastName: "R@zif" }));
    expect(res.status).toBe(400);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  // --- Auth-layer email_exists ----------------------------------------------

  it("returns 409 when auth reports email_exists", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "..." },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("EMAIL_EXISTS");
  });

  it("returns 409 when auth says the email is already registered", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: {
        message: "A user with this email address has already registered",
      },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("EMAIL_EXISTS");
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
    expect(mockDeleteEq).toHaveBeenCalledWith("auth_user_id", NEW_USER_ID);
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
    expect(mockDeleteEq).toHaveBeenCalledWith("auth_user_id", NEW_USER_ID);
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
    mockRpc.mockResolvedValue({ data: true, error: null });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("EMAIL_EXISTS");
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("asks whether the mailbox is taken, so a +tag variant gets a 409", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const res = await POST(
      makeRequest({ ...validBody, email: " Player+123@Example.com " }),
    );

    expect(mockRpc).toHaveBeenCalledWith("email_registered", {
      p_email: "player+123@example.com",
    });
    expect(res.status).toBe(409);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("creates the account with the address as typed, not the canonical one", async () => {
    await POST(makeRequest({ ...validBody, email: "Player+chess@Gmail.com" }));

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "player+chess@gmail.com" }),
    );
  });

  it("returns 500 without creating the user when the pre-check fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
    expect(mockCreateUser).not.toHaveBeenCalled();
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
