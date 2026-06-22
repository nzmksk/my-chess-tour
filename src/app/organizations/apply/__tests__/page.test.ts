import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("@/app/organizations/apply/_components/ApplyForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

const mockGetAuthClaims = vi.hoisted(() => vi.fn());

vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetAuthClaims,
}));

// ── Tests ─────────────────────────────────────────────────────

describe("OrganizerApplyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login when user is not authenticated", async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const { default: OrganizerApplyPage } = await import("../page");
    await OrganizerApplyPage();

    expect(mockRedirect).toHaveBeenCalledWith(
      "/auth/login?next=/organizations/apply",
    );
  });

  it("renders page content when user is authenticated", async () => {
    mockGetAuthClaims.mockResolvedValue({
      id: "user-id-123",
      email: "player@example.com",
      userMetadata: {},
    });

    const { default: OrganizerApplyPage } = await import("../page");
    const result = await OrganizerApplyPage();

    expect(result).not.toBeNull();
    expect(result).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
