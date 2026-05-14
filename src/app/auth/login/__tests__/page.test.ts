import { describe, expect, it, vi } from "vitest";

const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

const mockGetUser = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { user: null } }),
);

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/LoginForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import LoginPage from "../page";

describe("LoginPage", () => {
  it("returns a non-null React element", async () => {
    const result = await LoginPage();
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("has a min-h-screen container", async () => {
    const result = (await LoginPage()) as unknown as Record<string, unknown>;
    const props = result.props as Record<string, unknown>;
    expect(props.className).toContain("min-h-screen");
  });

  it("exports metadata with title 'Sign In'", async () => {
    const mod = await import("../page");
    expect(mod.metadata).toBeDefined();
    expect((mod.metadata as { title: string }).title).toBe("Sign In");
  });

  it("redirects to /tournaments when user is already logged in", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    await LoginPage();
    expect(mockRedirect).toHaveBeenCalledWith("/tournaments");
  });

  it("does not redirect when user is not logged in", async () => {
    mockRedirect.mockClear();
    await LoginPage();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
