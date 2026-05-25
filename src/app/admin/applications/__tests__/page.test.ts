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

vi.mock(
  "@/app/admin/applications/_components/ApplicationsClient",
  () => ({
    default: vi.fn().mockReturnValue(null),
  }),
);

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

function makeApplicationsPayload() {
  return {
    data: {
      counts: { pending: 2, approved: 5, rejected: 1, total: 8 },
      applications: [
        {
          id: "org-1",
          name: "Penang Chess Club",
          description: "Community club",
          email: "penang@chess.my",
          phone: "+60123456789",
          approval_status: "pending",
          rejection_reason: null,
          created_at: "2026-02-22T10:00:00Z",
          reviewed_at: null,
        },
      ],
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("AdminApplicationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
    mockHeadersGet.mockReturnValue("localhost:3000");
  });

  it("redirects to login when user is not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { default: AdminApplicationsPage } = await import("../page");
    await AdminApplicationsPage();

    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects to home when API returns a non-ok response", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const { default: AdminApplicationsPage } = await import("../page");
    await AdminApplicationsPage();

    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("renders page content when admin user is authenticated and data is available", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeApplicationsPayload(),
    });

    const { default: AdminApplicationsPage } = await import("../page");
    const result = await AdminApplicationsPage();

    expect(result).not.toBeNull();
    expect(result).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("uses http protocol for localhost", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockHeadersGet.mockReturnValue("localhost:3000");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeApplicationsPayload(),
    });

    const { default: AdminApplicationsPage } = await import("../page");
    await AdminApplicationsPage();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:3000/api/v1/admin/applications"),
      expect.any(Object),
    );
  });

  it("uses https protocol for non-localhost hosts", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockHeadersGet.mockReturnValue("mychessour.com");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeApplicationsPayload(),
    });

    const { default: AdminApplicationsPage } = await import("../page");
    await AdminApplicationsPage();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://mychessour.com/api/v1/admin/applications",
      ),
      expect.any(Object),
    );
  });

  it("falls back to localhost:3000 when host header is absent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockHeadersGet.mockReturnValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeApplicationsPayload(),
    });

    const { default: AdminApplicationsPage } = await import("../page");
    await AdminApplicationsPage();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "http://localhost:3000/api/v1/admin/applications",
      ),
      expect.any(Object),
    );
  });

  it("redirects to home when fetch throws a network error", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const { default: AdminApplicationsPage } = await import("../page");
    await AdminApplicationsPage();

    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to home when API returns null data", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: null }),
    });

    const { default: AdminApplicationsPage } = await import("../page");
    await AdminApplicationsPage();

    expect(mockRedirect).toHaveBeenCalledWith("/");
  });
});
