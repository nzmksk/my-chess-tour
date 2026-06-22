import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted so they run before imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        generateLink: mocks.generateLink,
      },
    },
  },
}));

vi.mock("@/services/email/email", () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}));

import { forgotPassword } from "../_actions/forgotPassword";
import { INITIAL_FORGOT_PASSWORD_STATE } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "hash-abc" } },
    error: null,
  });
  mocks.sendPasswordResetEmail.mockResolvedValue(undefined);
  process.env.NEXT_PUBLIC_SITE_URL = "https://mychesstour.com";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("forgotPassword action", () => {
  // --- INITIAL_FORGOT_PASSWORD_STATE export ---------------------------------

  it("exports INITIAL_FORGOT_PASSWORD_STATE with correct shape", () => {
    expect(INITIAL_FORGOT_PASSWORD_STATE).toEqual({
      error: null,
      submitted: false,
    });
  });

  // --- Validation errors ----------------------------------------------------

  it("returns error when email is empty", async () => {
    const fd = makeFormData({ email: "" });
    const result = await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(result.error).toBeDefined();
    expect(result.submitted).toBe(false);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("returns error when email is invalid", async () => {
    const fd = makeFormData({ email: "not-an-email" });
    const result = await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(result.error).toMatch(/email/i);
    expect(result.submitted).toBe(false);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  // --- generateLink params --------------------------------------------------

  it("calls generateLink with correct params", async () => {
    const fd = makeFormData({ email: "user@example.com" });
    await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(mocks.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "recovery",
        email: "user@example.com",
      }),
    );
  });

  // --- Success cases --------------------------------------------------------

  it("sends a callback link built from the token hash on success", async () => {
    const fd = makeFormData({ email: "user@example.com" });
    await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    const [sentEmail, sentLink] =
      mocks.sendPasswordResetEmail.mock.calls[0] ?? [];
    expect(sentEmail).toBe("user@example.com");
    expect(sentLink).toContain(
      "https://mychesstour.com/api/v1/auth/callback?",
    );
    expect(sentLink).toContain("token_hash=hash-abc");
    expect(sentLink).toContain("type=recovery");
    expect(sentLink).toContain("next=%2Fauth%2Fupdate-password");
  });

  it("returns submitted=true for a valid email", async () => {
    const fd = makeFormData({ email: "user@example.com" });
    const result = await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(result.error).toBeNull();
    expect(result.submitted).toBe(true);
  });

  // --- Silent error (email enumeration protection) -------------------------

  it("silently ignores generateLink errors (enum protection)", async () => {
    mocks.generateLink.mockResolvedValue({
      data: null,
      error: { message: "User not found" },
    });

    const fd = makeFormData({ email: "unknown@example.com" });
    const result = await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(result.submitted).toBe(true);
    expect(result.error).toBeNull();
  });

  it("does not send email when generateLink errors", async () => {
    mocks.generateLink.mockResolvedValue({
      data: null,
      error: { message: "User not found" },
    });

    const fd = makeFormData({ email: "unknown@example.com" });
    await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("does not send email when hashed_token is missing", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: undefined } },
      error: null,
    });

    const fd = makeFormData({ email: "user@example.com" });
    await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  // --- Whitespace trimming --------------------------------------------------

  it("trims whitespace from email", async () => {
    const fd = makeFormData({ email: "  user@example.com  " });
    await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(mocks.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "user@example.com" }),
    );
  });

  // --- Always submitted=true for valid email --------------------------------

  it("always returns submitted=true for valid email", async () => {
    const fd = makeFormData({ email: "user@example.com" });
    const result = await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(result.submitted).toBe(true);
  });
});
