import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted so they run before imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({ getAll: vi.fn(() => []), set: vi.fn() })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { signOut: mocks.signOut } }),
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import { logout } from "../actions";

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

  it("redirects to /signed-out on success", async () => {
    mocks.signOut.mockResolvedValue({ error: null });

    await logout();

    expect(mocks.redirect).toHaveBeenCalledWith("/signed-out");
  });

  it("still redirects to /signed-out when signOut returns an error", async () => {
    mocks.signOut.mockResolvedValue({
      error: { message: "Something went wrong" },
    });

    await logout();

    expect(mocks.redirect).toHaveBeenCalledWith("/signed-out");
  });
});
