import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted so they run before imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { updateUser: mocks.updateUser } })
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import { updatePassword } from "../_actions/updatePassword";
import { INITIAL_UPDATE_PASSWORD_STATE } from "../types";

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
  mocks.updateUser.mockResolvedValue({ error: null });
  // redirect in Next.js throws a special error internally; simulate that
  mocks.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("INITIAL_UPDATE_PASSWORD_STATE", () => {
  it("has correct shape", () => {
    expect(INITIAL_UPDATE_PASSWORD_STATE).toEqual({
      error: null,
      fieldErrors: {},
    });
  });
});

describe("updatePassword action", () => {
  // --- Validation errors ----------------------------------------------------

  it("returns password fieldError when password is empty", async () => {
    const fd = makeFormData({ password: "", confirmPassword: "" });
    const result = await updatePassword(INITIAL_UPDATE_PASSWORD_STATE, fd);

    expect(result.fieldErrors.password).toBeDefined();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("returns password fieldError when password is weak", async () => {
    const fd = makeFormData({ password: "weak", confirmPassword: "weak" });
    const result = await updatePassword(INITIAL_UPDATE_PASSWORD_STATE, fd);

    expect(result.fieldErrors.password).toBeDefined();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("returns confirmPassword fieldError when confirmPassword is empty", async () => {
    const fd = makeFormData({ password: "Strong1!", confirmPassword: "" });
    const result = await updatePassword(INITIAL_UPDATE_PASSWORD_STATE, fd);

    expect(result.fieldErrors.confirmPassword).toBeDefined();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("returns confirmPassword fieldError when passwords do not match", async () => {
    const fd = makeFormData({ password: "Strong1!", confirmPassword: "Different1!" });
    const result = await updatePassword(INITIAL_UPDATE_PASSWORD_STATE, fd);

    expect(result.fieldErrors.confirmPassword).toBeDefined();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  // --- Supabase error -------------------------------------------------------

  it("returns error state when supabase returns an error", async () => {
    mocks.updateUser.mockResolvedValue({ error: { message: "Auth session missing" } });

    const fd = makeFormData({ password: "Strong1!", confirmPassword: "Strong1!" });
    const result = await updatePassword(INITIAL_UPDATE_PASSWORD_STATE, fd);

    expect(result.error).toBe("Auth session missing");
    expect(result.fieldErrors).toEqual({});
  });

  // --- Success cases --------------------------------------------------------

  it("calls updateUser with the correct password on success", async () => {
    const fd = makeFormData({ password: "Strong1!", confirmPassword: "Strong1!" });

    await expect(
      updatePassword(INITIAL_UPDATE_PASSWORD_STATE, fd)
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "Strong1!" });
  });

  it("calls redirect to /login on success", async () => {
    const fd = makeFormData({ password: "Strong1!", confirmPassword: "Strong1!" });

    await expect(
      updatePassword(INITIAL_UPDATE_PASSWORD_STATE, fd)
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });
});
