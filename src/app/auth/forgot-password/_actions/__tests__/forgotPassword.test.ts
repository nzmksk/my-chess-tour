import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateForgotPasswordForm: vi.fn(),
  generateLink: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("@/services/auth/auth-validation", () => ({
  validateForgotPasswordForm: mocks.validateForgotPasswordForm,
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    auth: { admin: { generateLink: mocks.generateLink } },
  },
}));

vi.mock("@/services/email/email", () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}));

import { forgotPassword } from "../forgotPassword";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INITIAL = { error: null, submitted: false };

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.append(k, v);
  return fd;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("forgotPassword action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hash-abc" } },
      error: null,
    });
    mocks.sendPasswordResetEmail.mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_SITE_URL = "https://mychesstour.com";
  });

  // --- Validation -----------------------------------------------------------

  it("returns validation error and submitted:false when email is invalid", async () => {
    mocks.validateForgotPasswordForm.mockReturnValue({
      errors: { email: "Email address is required" },
      isValid: false,
    });

    const result = await forgotPassword(INITIAL, makeFormData({ email: "" }));

    expect(result.error).toBe("Email address is required");
    expect(result.submitted).toBe(false);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("uses fallback error message when errors.email is not set but isValid is false", async () => {
    mocks.validateForgotPasswordForm.mockReturnValue({
      errors: {},
      isValid: false,
    });

    const result = await forgotPassword(INITIAL, makeFormData({ email: "x" }));

    expect(result.error).toBe("Please enter a valid email address.");
    expect(result.submitted).toBe(false);
  });

  it("handles missing email key in FormData (passes empty string to validator)", async () => {
    mocks.validateForgotPasswordForm.mockReturnValue({
      errors: { email: "Email address is required" },
      isValid: false,
    });

    const fd = new FormData();
    await forgotPassword(INITIAL, fd);

    expect(mocks.validateForgotPasswordForm).toHaveBeenCalledWith("");
  });

  it("trims email whitespace before validating", async () => {
    mocks.validateForgotPasswordForm.mockReturnValue({
      errors: {},
      isValid: true,
    });

    await forgotPassword(
      INITIAL,
      makeFormData({ email: "  user@example.com  " }),
    );

    expect(mocks.validateForgotPasswordForm).toHaveBeenCalledWith(
      "user@example.com",
    );
  });

  // --- Success path ---------------------------------------------------------

  it("returns submitted:true after successful link generation and email send", async () => {
    mocks.validateForgotPasswordForm.mockReturnValue({
      errors: {},
      isValid: true,
    });

    const result = await forgotPassword(
      INITIAL,
      makeFormData({ email: "user@example.com" }),
    );

    expect(result.submitted).toBe(true);
    expect(result.error).toBeNull();

    const [sentEmail, sentLink] =
      mocks.sendPasswordResetEmail.mock.calls[0] ?? [];
    expect(sentEmail).toBe("user@example.com");
    expect(sentLink).toContain("https://mychesstour.com/api/v1/auth/callback?");
    expect(sentLink).toContain("token_hash=hash-abc");
    expect(sentLink).toContain("type=recovery");
    expect(sentLink).toContain("next=%2Fauth%2Fupdate-password");
  });

  // --- Error from Supabase (email enumeration guard) -----------------------

  it("does not send email when generateLink returns an error", async () => {
    mocks.validateForgotPasswordForm.mockReturnValue({
      errors: {},
      isValid: true,
    });
    mocks.generateLink.mockResolvedValue({
      data: { properties: {} },
      error: { message: "User not found" },
    });

    const result = await forgotPassword(
      INITIAL,
      makeFormData({ email: "unknown@example.com" }),
    );

    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(result.submitted).toBe(true);
  });

  it("still returns submitted:true when sending the email throws", async () => {
    mocks.validateForgotPasswordForm.mockReturnValue({
      errors: {},
      isValid: true,
    });
    mocks.sendPasswordResetEmail.mockRejectedValue(new Error("Resend down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await forgotPassword(
      INITIAL,
      makeFormData({ email: "user@example.com" }),
    );

    expect(result.submitted).toBe(true);
    expect(result.error).toBeNull();

    consoleSpy.mockRestore();
  });

  it("does not send email when hashed_token is missing", async () => {
    mocks.validateForgotPasswordForm.mockReturnValue({
      errors: {},
      isValid: true,
    });
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: null } },
      error: null,
    });

    await forgotPassword(INITIAL, makeFormData({ email: "user@example.com" }));

    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
