import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

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
  "@/app/admin/applications/[id]/_components/ApplicationDetailClient",
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

const mockSingle = vi.hoisted(() => vi.fn());
const mockIs = vi.hoisted(() => vi.fn().mockReturnValue({ single: mockSingle }));
const mockEq = vi.hoisted(() => vi.fn().mockReturnValue({ is: mockIs }));
const mockSelect = vi.hoisted(() => vi.fn().mockReturnValue({ eq: mockEq }));
const mockFrom = vi.hoisted(() =>
  vi.fn().mockReturnValue({ select: mockSelect }),
);

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

// ── Fixtures ───────────────────────────────────────────────────────────────

const APP_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const NOT_UUID = "not-a-uuid";

function makeApplicationDetail() {
  return {
    id: APP_ID,
    name: "Penang Chess Club",
    description: "Community club",
    links: [{ label: "Website", url: "https://penangchess.org" }],
    email: "penang@chess.my",
    phone: "+60123456789",
    past_tournament_refs: "Penang Open 2025",
    approval_status: "pending",
    rejection_reason: null,
    created_at: "2026-02-22T10:00:00Z",
    reviewed_at: null,
    applicant: {
      id: "cccccccc-0000-0000-0000-000000000001",
      first_name: "Lee",
      last_name: "Wei Hao",
      email: "weihao@gmail.com",
      created_at: "2026-01-15T00:00:00Z",
      player_profiles: null,
    },
  };
}

async function importPage() {
  const { default: AdminApplicationDetailPage } = await import("../page");
  return AdminApplicationDetailPage;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AdminApplicationDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockIs.mockReturnValue({ single: mockSingle });
    mockEq.mockReturnValue({ is: mockIs });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });

    mockRedirect.mockImplementation((url: string) => {
      const err = new Error(`NEXT_REDIRECT:${url}`);
      (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};303;`;
      throw err;
    });
  });

  it("redirects to /admin/applications when ID is not a valid UUID", async () => {
    const AdminApplicationDetailPage = await importPage();
    await expect(
      AdminApplicationDetailPage({ params: Promise.resolve({ id: NOT_UUID }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/applications");
  });

  it("redirects to /auth/login when user is not authenticated", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null } });

    const AdminApplicationDetailPage = await importPage();
    await expect(
      AdminApplicationDetailPage({ params: Promise.resolve({ id: APP_ID }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/auth/login");
  });

  it("redirects to / when user lacks admin permission", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    mockRpc.mockResolvedValue({ data: false, error: null });

    const AdminApplicationDetailPage = await importPage();
    await expect(
      AdminApplicationDetailPage({ params: Promise.resolve({ id: APP_ID }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("redirects to /admin/applications when DB query fails", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSingle.mockResolvedValue({ data: null, error: { message: "DB error" } });

    const AdminApplicationDetailPage = await importPage();
    await expect(
      AdminApplicationDetailPage({ params: Promise.resolve({ id: APP_ID }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/applications");
  });

  it("redirects to /admin/applications when application is not found", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSingle.mockResolvedValue({ data: null, error: null });

    const AdminApplicationDetailPage = await importPage();
    await expect(
      AdminApplicationDetailPage({ params: Promise.resolve({ id: APP_ID }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/applications");
  });

  it("renders the page when admin is authenticated and data is found", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSingle.mockResolvedValue({ data: makeApplicationDetail(), error: null });

    const AdminApplicationDetailPage = await importPage();
    const result = await AdminApplicationDetailPage({
      params: Promise.resolve({ id: APP_ID }),
    });

    expect(result).not.toBeNull();
    expect(result).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("checks admin permission with correct parameters", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSingle.mockResolvedValue({ data: makeApplicationDetail(), error: null });

    const AdminApplicationDetailPage = await importPage();
    await AdminApplicationDetailPage({ params: Promise.resolve({ id: APP_ID }) });

    expect(mockRpc).toHaveBeenCalledWith("has_global_permission", {
      p_user_id: "admin-1",
      p_permission: "platform.manage",
    });
  });

  it("queries organization with correct ID and excludes deleted records", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSingle.mockResolvedValue({ data: makeApplicationDetail(), error: null });

    const AdminApplicationDetailPage = await importPage();
    await AdminApplicationDetailPage({ params: Promise.resolve({ id: APP_ID }) });

    expect(mockFrom).toHaveBeenCalledWith("organizations");
    expect(mockEq).toHaveBeenCalledWith("id", APP_ID);
    expect(mockIs).toHaveBeenCalledWith("deleted_at", null);
  });
});
