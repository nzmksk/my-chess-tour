import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted so they run before imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        generateLink: mocks.generateLink,
      },
    },
  },
}));

vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}));

import { forgotPassword } from "../actions";
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
    data: { properties: { action_link: "https://supabase.example.com/auth/v1/verify?token=abc" } },
    error: null,
  });
  mocks.sendPasswordResetEmail.mockResolvedValue(undefined);
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
        options: expect.objectContaining({
          redirectTo: expect.stringContaining("/auth/callback"),
        }),
      }),
    );
  });

  it("redirectTo contains /auth/callback and /auth/update-password", async () => {
    const fd = makeFormData({ email: "user@example.com" });
    await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    const callArg = mocks.generateLink.mock.calls[0][0];
    expect(callArg.options.redirectTo).toContain("/auth/callback");
    expect(callArg.options.redirectTo).toContain("/auth/update-password");
  });

  // --- Success cases --------------------------------------------------------

  it("sends email on success", async () => {
    const fd = makeFormData({ email: "user@example.com" });
    await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      "user@example.com",
      "https://supabase.example.com/auth/v1/verify?token=abc",
    );
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

  it("does not send email when action_link is missing", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: { action_link: undefined } },
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
