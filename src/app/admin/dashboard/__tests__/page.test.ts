import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockHeadersGet = vi.hoisted(() =>
  vi.fn().mockReturnValue("localhost:3000"),
);

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: mockHeadersGet }),
}));

const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@/app/admin/dashboard/_components/AdminDashboardClient", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

const mockGetUser = vi.hoisted(() => vi.fn());

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

// ── Helpers ───────────────────────────────────────────────────

const mockFetch = vi.fn();

function makeDashboardPayload() {
  return {
    data: {
      stats: {
        total_users: 55,
        organizations: { total: 5, pending: 1, approved: 4, rejected: 0 },
        tournaments: { total: 15, published: 8, draft: 5, cancelled: 2 },
        total_registrations: 120,
        platform_revenue_cents: 50000,
      },
      pending_organizations: [
        {
          id: "org-1",
          name: "New Chess Club",
          email: "newclub@example.com",
          created_at: "2026-01-15T10:00:00Z",
        },
      ],
      recent_tournaments: [
        {
          id: "tour-1",
          name: "KL Open Rapid 2026",
          organization_name: "KL Chess Association",
          start_date: "2026-03-15",
          status: "published",
          current_participants: 20,
          max_participants: 120,
        },
      ],
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("AdminDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
    mockHeadersGet.mockReturnValue("localhost:3000");
  });

  it("redirects to login when user is not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { default: AdminDashboardPage } = await import("../page");
    await AdminDashboardPage();

    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects to home when API returns no data", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const { default: AdminDashboardPage } = await import("../page");
    await AdminDashboardPage();

    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("renders page content when admin user is authenticated and data is available", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeDashboardPayload(),
    });

    const { default: AdminDashboardPage } = await import("../page");
    const result = await AdminDashboardPage();

    expect(result).not.toBeNull();
    expect(result).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("uses http protocol for localhost", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockHeadersGet.mockReturnValue("localhost:3000");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeDashboardPayload(),
    });

    const { default: AdminDashboardPage } = await import("../page");
    await AdminDashboardPage();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:3000/api/v1/admin/dashboard"),
      expect.any(Object),
    );
  });

  it("uses https protocol for non-localhost hosts", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockHeadersGet.mockReturnValue("mychessour.com");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeDashboardPayload(),
    });

    const { default: AdminDashboardPage } = await import("../page");
    await AdminDashboardPage();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://mychessour.com/api/v1/admin/dashboard"),
      expect.any(Object),
    );
  });

  it("falls back to localhost:3000 when host header is absent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockHeadersGet.mockReturnValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeDashboardPayload(),
    });

    const { default: AdminDashboardPage } = await import("../page");
    await AdminDashboardPage();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:3000/api/v1/admin/dashboard"),
      expect.any(Object),
    );
  });

  it("redirects to home when fetch throws a network error", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const { default: AdminDashboardPage } = await import("../page");
    await AdminDashboardPage();

    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to home when API returns null data", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: null }),
    });

    const { default: AdminDashboardPage } = await import("../page");
    await AdminDashboardPage();

    expect(mockRedirect).toHaveBeenCalledWith("/");
  });
});
