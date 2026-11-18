import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: () => "localhost:3000" }),
}));

// Keep the server-only auth/DB chain out of this smoke test.
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import HomePage, { metadata } from "../page";

describe("HomePage (tournament list at /)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not redirect", () => {
    HomePage();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("returns a non-null React element", () => {
    const result = HomePage();
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("uses the tournament list metadata", () => {
    expect(metadata.title).toEqual({
      absolute: "Upcoming Chess Tournaments in Malaysia | MY Chess Tour",
    });
  });
});
