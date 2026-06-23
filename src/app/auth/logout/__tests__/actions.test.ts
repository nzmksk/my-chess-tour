import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted so they run before imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      getAll: vi.fn(() => []),
      set: vi.fn(),
      delete: vi.fn(),
    }),
  ),
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { signOut: mocks.signOut } }),
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import { logout } from "../_actions/logout";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("logout action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls signOut once", async () => {
    mocks.signOut.mockResolvedValue({ error: null });

    await logout();

    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("signs out with local scope (this device only)", async () => {
    mocks.signOut.mockResolvedValue({ error: null });

    await logout();

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("redirects to /auth/logout on success", async () => {
    mocks.signOut.mockResolvedValue({ error: null });

    await logout();

    expect(mocks.redirect).toHaveBeenCalledWith("/auth/logout");
  });

  it("still redirects to /auth/logout when signOut returns an error", async () => {
    mocks.signOut.mockResolvedValue({
      error: { message: "Something went wrong" },
    });

    await logout();

    expect(mocks.redirect).toHaveBeenCalledWith("/auth/logout");
  });
});
