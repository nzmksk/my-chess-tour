import { beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";

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

// The page now issues three differently-shaped queries (organizations →
// .is().single(); bank account → .eq().eq().maybeSingle(); documents →
// .eq().order()), so the builder has to be chainable rather than a fixed chain.
// The individual spies are still shared, which is what the assertions below
// read.
const mockSingle = vi.hoisted(() => vi.fn());
const mockMaybeSingle = vi.hoisted(() => vi.fn());
const mockOrder = vi.hoisted(() => vi.fn());
const mockIs = vi.hoisted(() => vi.fn());
const mockEq = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());
const mockCreateSignedUrl = vi.hoisted(() => vi.fn());

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    from: mockFrom,
    storage: { from: vi.fn(() => ({ createSignedUrl: mockCreateSignedUrl })) },
  },
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

    const builder = {
      select: mockSelect,
      eq: mockEq,
      is: mockIs,
      order: mockOrder,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
    };
    mockSelect.mockReturnValue(builder);
    mockEq.mockReturnValue(builder);
    mockIs.mockReturnValue(builder);
    mockFrom.mockReturnValue(builder);

    // Defaults for the two queries added alongside the KYB review sections.
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/doc" },
      error: null,
    });

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
      p_user_id: appIdFor("admin-1"),
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

  it("passes only the last 4 digits of the account number to the client", async () => {
    // The reviewer needs to recognise the account, not read it. Masking here in
    // the server component keeps the full number out of the client bundle
    // entirely — the same rule the API follows.
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSingle.mockResolvedValue({ data: makeApplicationDetail(), error: null });
    mockMaybeSingle.mockResolvedValue({
      data: {
        bank_name: "Maybank",
        bank_code: "MBBEMYKL",
        account_holder: "Penang Chess Club",
        account_number: "514012345678",
        status: "pending",
        rejection_reason: null,
      },
      error: null,
    });

    const AdminApplicationDetailPage = await importPage();
    const result = await AdminApplicationDetailPage({
      params: Promise.resolve({ id: APP_ID }),
    });

    const rendered = JSON.stringify(result);
    expect(rendered).toContain("5678");
    expect(rendered).not.toContain("514012345678");
  });

  it("signs each document URL server-side with a 5-minute expiry", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSingle.mockResolvedValue({ data: makeApplicationDetail(), error: null });
    mockOrder.mockResolvedValue({
      data: [
        {
          id: "dddddddd-0000-0000-0000-000000000001",
          doc_type: "ros",
          storage_path: "users/u1/org-kyb/ros.pdf",
          original_filename: "ros.pdf",
        },
      ],
      error: null,
    });

    const AdminApplicationDetailPage = await importPage();
    await AdminApplicationDetailPage({ params: Promise.resolve({ id: APP_ID }) });

    expect(mockCreateSignedUrl).toHaveBeenCalledWith(
      "users/u1/org-kyb/ros.pdf",
      300,
    );
  });
});
