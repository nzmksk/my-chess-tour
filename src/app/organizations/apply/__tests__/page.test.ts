import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock(
  "@/app/organizer/apply/_components/ApplyForm",
  () => ({
    default: vi.fn().mockReturnValue(null),
  }),
);

const mockGetUser = vi.hoisted(() => vi.fn());

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

// ── Tests ─────────────────────────────────────────────────────

describe("OrganizerApplyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login when user is not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { default: OrganizerApplyPage } = await import("../page");
    await OrganizerApplyPage();

    expect(mockRedirect).toHaveBeenCalledWith(
      "/auth/login?next=/organizations/applications",
    );
  });

  it("renders page content when user is authenticated", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-id-123" } },
    });

    const { default: OrganizerApplyPage } = await import("../page");
    const result = await OrganizerApplyPage();

    expect(result).not.toBeNull();
    expect(result).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
