import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

// Mock next/headers (imported transitively by lib/supabase/server)
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({ getAll: vi.fn(() => []), set: vi.fn() })),
}));

const mockSignOut = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { signOut: mockSignOut } })
  ),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Success cases --------------------------------------------------------

  it("returns 200 with success message on valid logout", async () => {
    mockSignOut.mockResolvedValue({ error: null });

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/logged out/i);
  });

  it("calls signOut once", async () => {
    mockSignOut.mockResolvedValue({ error: null });

    await POST();

    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  // --- Supabase error handling ----------------------------------------------

  it("returns 400 when Supabase signOut fails", async () => {
    mockSignOut.mockResolvedValue({
      error: { message: "Something went wrong" },
    });

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Something went wrong");
  });
});
