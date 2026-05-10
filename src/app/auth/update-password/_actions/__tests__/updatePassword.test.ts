import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateUpdatePasswordForm: vi.fn(),
  updateUser: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/services/auth/auth-validation", () => ({
  validateUpdatePasswordForm: mocks.validateUpdatePasswordForm,
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { updateUser: mocks.updateUser } }),
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import { updatePassword } from "../updatePassword";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INITIAL = { error: null, fieldErrors: {} };

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.append(k, v);
  return fd;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("updatePassword action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateUser.mockResolvedValue({ error: null });
  });

  // --- Validation -----------------------------------------------------------

  it("returns fieldErrors and no redirect when validation fails", async () => {
    mocks.validateUpdatePasswordForm.mockReturnValue({
      errors: { password: "Password is required" },
      isValid: false,
    });

    const fd = makeFormData({ password: "", confirmPassword: "" });
    const result = await updatePassword(INITIAL, fd);

    expect(result.fieldErrors).toEqual({ password: "Password is required" });
    expect(result.error).toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("handles missing password and confirmPassword keys in FormData", async () => {
    mocks.validateUpdatePasswordForm.mockReturnValue({
      errors: { password: "Password is required" },
      isValid: false,
    });

    const fd = new FormData(); // no keys at all
    await updatePassword(INITIAL, fd);

    expect(mocks.validateUpdatePasswordForm).toHaveBeenCalledWith("", "");
  });

  // --- Success path ---------------------------------------------------------

  it("calls updateUser and redirects to /auth/login on success", async () => {
    mocks.validateUpdatePasswordForm.mockReturnValue({
      errors: {},
      isValid: true,
    });

    const fd = makeFormData({
      password: "Password1!",
      confirmPassword: "Password1!",
    });
    await updatePassword(INITIAL, fd);

    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "Password1!" });
    expect(mocks.redirect).toHaveBeenCalledWith("/auth/login");
  });

  // --- Supabase error -------------------------------------------------------

  it("returns error message when updateUser fails", async () => {
    mocks.validateUpdatePasswordForm.mockReturnValue({
      errors: {},
      isValid: true,
    });
    mocks.updateUser.mockResolvedValue({
      error: { message: "Auth session missing" },
    });

    const fd = makeFormData({
      password: "Password1!",
      confirmPassword: "Password1!",
    });
    const result = await updatePassword(INITIAL, fd);

    expect(result.error).toBe("Auth session missing");
    expect(result.fieldErrors).toEqual({});
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
