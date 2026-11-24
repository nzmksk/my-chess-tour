import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRedirect, mockGetAuthClaims } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
  mockGetAuthClaims: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));
vi.mock("@/app/settings/dependents/_components/DependentsManager", () => ({
  default: vi.fn().mockReturnValue(null),
}));
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetAuthClaims,
}));

import DependentsPage from "../page";

describe("DependentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a signed-out visitor to log in and back", async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    await DependentsPage();
    expect(mockRedirect).toHaveBeenCalledWith(
      "/auth/login?redirectTo=/settings/dependents&message=login-required",
    );
  });

  it("renders for a signed-in user", async () => {
    mockGetAuthClaims.mockResolvedValue({ id: "user-1" });
    expect(await DependentsPage()).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
