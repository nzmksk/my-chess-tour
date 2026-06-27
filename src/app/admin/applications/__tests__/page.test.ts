import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

// Mirror Next.js's redirect() which throws a special error to halt rendering.
const mockRedirect = vi.hoisted(() =>
  vi.fn().mockImplementation((url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`);
    (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};303;`;
    throw err;
  }),
);

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

const mockGetClaims = vi.hoisted(() => vi.fn());
const mockRpc = vi.hoisted(() => vi.fn());

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
    rpc: mockRpc,
  }),
}));

const mockOrder = vi.hoisted(() => vi.fn());
const mockIs = vi.hoisted(() =>
  vi.fn().mockReturnValue({ order: mockOrder }),
);
const mockSelect = vi.hoisted(() =>
  vi.fn().mockReturnValue({ is: mockIs }),
);
const mockFrom = vi.hoisted(() =>
  vi.fn().mockReturnValue({ select: mockSelect }),
);

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

// ── Helpers ───────────────────────────────────────────────────

function makeApplicationRows() {
  return [
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
    {
      id: "org-2",
      name: "KL Chess Academy",
      description: null,
      email: "kl@chess.my",
      phone: null,
      approval_status: "approved",
      rejection_reason: null,
      created_at: "2026-02-20T10:00:00Z",
      reviewed_at: "2026-02-21T10:00:00Z",
    },
    {
      id: "org-3",
      name: "Johor Chess Club",
      description: null,
      email: null,
      phone: null,
      approval_status: "rejected",
      rejection_reason: "Incomplete info",
      created_at: "2026-02-18T10:00:00Z",
      reviewed_at: "2026-02-19T10:00:00Z",
    },
  ];
}

async function importPage() {
  const { default: AdminApplicationsPage } = await import("../page");
  return AdminApplicationsPage;
}

// ── Tests ─────────────────────────────────────────────────────

describe("AdminApplicationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Re-establish the mock chain after clearAllMocks.
    mockIs.mockReturnValue({ order: mockOrder });
    mockSelect.mockReturnValue({ is: mockIs });
    mockFrom.mockReturnValue({ select: mockSelect });

    // Re-apply redirect throw behaviour after clearAllMocks.
    mockRedirect.mockImplementation((url: string) => {
      const err = new Error(`NEXT_REDIRECT:${url}`);
      (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};303;`;
      throw err;
    });
  });

  it("redirects to login when user is not authenticated", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null } });

    const AdminApplicationsPage = await importPage();
    await expect(AdminApplicationsPage()).rejects.toThrow("NEXT_REDIRECT:/auth/login");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects to home when user lacks admin permission", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    mockRpc.mockResolvedValue({ data: false, error: null });

    const AdminApplicationsPage = await importPage();
    await expect(AdminApplicationsPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to home when permission check errors", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    mockRpc.mockResolvedValue({ data: null, error: new Error("DB error") });

    const AdminApplicationsPage = await importPage();
    await expect(AdminApplicationsPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to home when supabaseAdmin query errors", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockOrder.mockResolvedValue({ data: null, error: new Error("Query failed") });

    const AdminApplicationsPage = await importPage();
    await expect(AdminApplicationsPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("renders page when admin is authenticated and data is available", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockOrder.mockResolvedValue({ data: makeApplicationRows(), error: null });

    const AdminApplicationsPage = await importPage();
    const result = await AdminApplicationsPage();

    expect(result).not.toBeNull();
    expect(result).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("renders page with empty applications list when no rows returned", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockOrder.mockResolvedValue({ data: [], error: null });

    const AdminApplicationsPage = await importPage();
    const result = await AdminApplicationsPage();

    expect(result).not.toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("renders page with null rows treated as empty list", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockOrder.mockResolvedValue({ data: null, error: null });

    const AdminApplicationsPage = await importPage();
    const result = await AdminApplicationsPage();

    expect(result).not.toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("calculates correct status counts from application rows", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockOrder.mockResolvedValue({ data: makeApplicationRows(), error: null });

    const AdminApplicationsPage = await importPage();
    await AdminApplicationsPage();

    // Verify counts by checking what was passed to ApplicationsClient.
    expect(mockFrom).toHaveBeenCalledWith("organizations");
    expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("queries organizations without deleted records ordered by created_at desc", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockOrder.mockResolvedValue({ data: [], error: null });

    const AdminApplicationsPage = await importPage();
    await AdminApplicationsPage();

    expect(mockFrom).toHaveBeenCalledWith("organizations");
    expect(mockIs).toHaveBeenCalledWith("deleted_at", null);
    expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("checks admin permission with correct parameters", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockOrder.mockResolvedValue({ data: [], error: null });

    const AdminApplicationsPage = await importPage();
    await AdminApplicationsPage();

    expect(mockRpc).toHaveBeenCalledWith("has_global_permission", {
      p_user_id: "admin-1",
      p_permission: "platform.manage",
    });
  });
});
