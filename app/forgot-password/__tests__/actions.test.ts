import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted so they run before imports
// ---------------------------------------------------------------------------

const mockResetPasswordForEmail = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { resetPasswordForEmail: mockResetPasswordForEmail },
    }),
  ),
}));

import { forgotPassword, INITIAL_FORGOT_PASSWORD_STATE } from "../actions";

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
  mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
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
    expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("returns error when email is invalid", async () => {
    const fd = makeFormData({ email: "not-an-email" });
    const result = await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(result.error).toMatch(/email/i);
    expect(result.submitted).toBe(false);
    expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
  });

  // --- Success cases --------------------------------------------------------

  it("returns submitted=true for a valid email", async () => {
    const fd = makeFormData({ email: "user@example.com" });
    const result = await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(result.error).toBeNull();
    expect(result.submitted).toBe(true);
  });

  it("calls supabase resetPasswordForEmail with correct email", async () => {
    const fd = makeFormData({ email: "user@example.com" });
    await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      "user@example.com",
      expect.objectContaining({ redirectTo: expect.stringContaining("/auth/callback") }),
    );
  });

  it("trims whitespace from email", async () => {
    const fd = makeFormData({ email: "  user@example.com  " });
    await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      "user@example.com",
      expect.any(Object),
    );
  });

  it("returns submitted=true even when supabase returns an error (prevents email enumeration)", async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: "User not found" },
    });

    const fd = makeFormData({ email: "unknown@example.com" });
    const result = await forgotPassword(INITIAL_FORGOT_PASSWORD_STATE, fd);

    expect(result.submitted).toBe(true);
    expect(result.error).toBeNull();
  });
});
