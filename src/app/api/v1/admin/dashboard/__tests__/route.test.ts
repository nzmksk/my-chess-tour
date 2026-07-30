import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockUsersBuilder,
  mockOrgStatusBuilder,
  mockTourStatusBuilder,
  mockRegCountBuilder,
  mockPayoutBuilder,
  mockPendingOrgsBuilder,
  mockRecentToursBuilder,
  mockRecentRegsBuilder,
  mockOrgNamesBuilder,
  mockFrom,
  mockGetClaims,
  mockRpc,
} = vi.hoisted(() => {
  function makeBuilder(finalResult: {
    data?: unknown;
    count?: unknown;
    error?: unknown;
  }) {
    const b: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "in",
      "is",
      "order",
      "limit",
      "single",
      "maybeSingle",
    ]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) => Promise.resolve(finalResult).then(onfulfilled, onrejected);
    return b;
  }

  const mockUsersBuilder = makeBuilder({ count: 55, error: null });
  const mockOrgStatusBuilder = makeBuilder({ data: [], error: null });
  const mockTourStatusBuilder = makeBuilder({ data: [], error: null });
  const mockRegCountBuilder = makeBuilder({ count: 0, error: null });
  const mockPayoutBuilder = makeBuilder({ data: [], error: null });
  const mockPendingOrgsBuilder = makeBuilder({ data: [], error: null });
  const mockRecentToursBuilder = makeBuilder({ data: [], error: null });
  const mockRecentRegsBuilder = makeBuilder({ data: [], error: null });
  const mockOrgNamesBuilder = makeBuilder({ data: [], error: null });

  // Track which "organizations" call this is — first for status, second for pending list
  let orgCallIndex = 0;
  // Track which "tournaments" call this is — first for status, second for recent
  let tourCallIndex = 0;
  // Track registrations calls — first for count, second for recent regs list
  let regCallIndex = 0;

  const mockFrom = vi.fn((table: string) => {
    if (table === "users") return mockUsersBuilder;
    if (table === "tournament_payout_summary") return mockPayoutBuilder;
    if (table === "organizations") {
      const idx = orgCallIndex++;
      if (idx === 0) return mockOrgStatusBuilder;
      if (idx === 1) return mockPendingOrgsBuilder;
      return mockOrgNamesBuilder; // phase 2 org names
    }
    if (table === "tournaments") {
      const idx = tourCallIndex++;
      if (idx === 0) return mockTourStatusBuilder;
      return mockRecentToursBuilder;
    }
    if (table === "registrations") {
      const idx = regCallIndex++;
      if (idx === 0) return mockRegCountBuilder;
      return mockRecentRegsBuilder;
    }
    return mockUsersBuilder;
  });

  (mockFrom as unknown as { _reset: () => void })._reset = () => {
    orgCallIndex = 0;
    tourCallIndex = 0;
    regCallIndex = 0;
  };

  const mockGetClaims = vi.fn();
  const mockRpc = vi.fn();

  return {
    mockUsersBuilder,
    mockOrgStatusBuilder,
    mockTourStatusBuilder,
    mockRegCountBuilder,
    mockPayoutBuilder,
    mockPendingOrgsBuilder,
    mockRecentToursBuilder,
    mockRecentRegsBuilder,
    mockOrgNamesBuilder,
    mockFrom,
    mockGetClaims,
    mockRpc,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
    rpc: mockRpc,
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

import { GET } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";

const ORG_ID_1 = "bbbbbbbb-0000-0000-0000-000000000001";
const ORG_ID_2 = "bbbbbbbb-0000-0000-0000-000000000002";

const TOUR_ID_1 = "cccccccc-0000-0000-0000-000000000001";
const TOUR_ID_2 = "cccccccc-0000-0000-0000-000000000002";

const APPROVED_ORG_STATUS = { approval_status: "approved" };
const PENDING_ORG_STATUS = { approval_status: "pending" };
const REJECTED_ORG_STATUS = { approval_status: "rejected" };

const PUBLISHED_TOUR_STATUS = { status: "published" };
const DRAFT_TOUR_STATUS = { status: "draft" };
const CANCELLED_TOUR_STATUS = { status: "cancelled" };

const RECENT_TOUR_1 = {
  id: TOUR_ID_1,
  name: "KL Open Rapid 2026",
  start_date: "2026-03-15",
  status: "published",
  max_participants: 120,
  organization_id: ORG_ID_1,
};

const RECENT_TOUR_2 = {
  id: TOUR_ID_2,
  name: "Selangor Blitz 2026",
  start_date: "2026-04-01",
  status: "draft",
  max_participants: 60,
  organization_id: ORG_ID_2,
};

const PENDING_ORG_1 = {
  id: ORG_ID_2,
  name: "New Chess Club",
  email: "newclub@example.com",
  created_at: "2026-01-15T10:00:00Z",
};

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/v1/admin/dashboard");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setUser(id = ADMIN_USER_ID) {
  mockGetClaims.mockResolvedValue({ data: { claims: { sub: id } }, error: null });
}

function setNoUser() {
  mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
}

function setAdminPermission(isAdmin: boolean) {
  mockRpc.mockResolvedValue({ data: isAdmin, error: null });
}

function setResult(
  builder: Record<string, unknown>,
  result: { data?: unknown; count?: unknown; error?: unknown },
) {
  builder.then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
}

function resetCallIndexes() {
  (mockFrom as unknown as { _reset: () => void })._reset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/admin/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCallIndexes();
    setUser();
    setAdminPermission(true);
    setResult(mockUsersBuilder, { count: 55, error: null });
    setResult(mockOrgStatusBuilder, {
      data: [APPROVED_ORG_STATUS, APPROVED_ORG_STATUS, PENDING_ORG_STATUS],
      error: null,
    });
    setResult(mockTourStatusBuilder, {
      data: [PUBLISHED_TOUR_STATUS, DRAFT_TOUR_STATUS],
      error: null,
    });
    setResult(mockRegCountBuilder, { count: 120, error: null });
    setResult(mockPayoutBuilder, {
      data: [{ effective_platform_fee_cents: 10000 }],
      error: null,
    });
    setResult(mockPendingOrgsBuilder, { data: [PENDING_ORG_1], error: null });
    setResult(mockRecentToursBuilder, {
      data: [RECENT_TOUR_1, RECENT_TOUR_2],
      error: null,
    });
    setResult(mockRecentRegsBuilder, {
      data: [{ tournament_id: TOUR_ID_1 }, { tournament_id: TOUR_ID_1 }],
      error: null,
    });
    setResult(mockOrgNamesBuilder, {
      data: [
        { id: ORG_ID_1, name: "KL Chess Association" },
        { id: ORG_ID_2, name: "Selangor Chess Federation" },
      ],
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      setNoUser();
      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe("authorization", () => {
    it("returns 403 when user does not have platform.manage permission", async () => {
      setAdminPermission(false);
      const res = await GET(makeRequest());
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/admin access required/i);
    });

    it("checks the platform.manage permission with the correct user id", async () => {
      await GET(makeRequest());
      expect(mockRpc).toHaveBeenCalledWith("has_global_permission", {
        p_user_id: appIdFor(ADMIN_USER_ID),
        p_permission: "platform.manage",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe("response shape", () => {
    it("returns 200 with data object containing stats, pending_organizations, and recent_tournaments", async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty("data");
      expect(json.data).toHaveProperty("stats");
      expect(json.data).toHaveProperty("pending_organizations");
      expect(json.data).toHaveProperty("recent_tournaments");
    });

    it("stats includes all expected fields", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.stats).toHaveProperty("total_users");
      expect(data.stats).toHaveProperty("organizations");
      expect(data.stats).toHaveProperty("tournaments");
      expect(data.stats).toHaveProperty("total_registrations");
      expect(data.stats).toHaveProperty("platform_revenue_cents");
    });

    it("organizations stats has total, pending, approved, rejected", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.stats.organizations).toHaveProperty("total");
      expect(data.stats.organizations).toHaveProperty("pending");
      expect(data.stats.organizations).toHaveProperty("approved");
      expect(data.stats.organizations).toHaveProperty("rejected");
    });

    it("tournaments stats has total, published, draft, cancelled", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.stats.tournaments).toHaveProperty("total");
      expect(data.stats.tournaments).toHaveProperty("published");
      expect(data.stats.tournaments).toHaveProperty("draft");
      expect(data.stats.tournaments).toHaveProperty("cancelled");
    });

    it("shapes each pending_organization correctly", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(Array.isArray(data.pending_organizations)).toBe(true);
      const org = data.pending_organizations[0];
      expect(org).toHaveProperty("id");
      expect(org).toHaveProperty("name");
      expect(org).toHaveProperty("email");
      expect(org).toHaveProperty("created_at");
    });

    it("shapes each recent_tournament correctly", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(Array.isArray(data.recent_tournaments)).toBe(true);
      const t = data.recent_tournaments[0];
      expect(t).toHaveProperty("id");
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("organization_name");
      expect(t).toHaveProperty("start_date");
      expect(t).toHaveProperty("status");
      expect(t).toHaveProperty("current_participants");
      expect(t).toHaveProperty("max_participants");
    });
  });

  // -------------------------------------------------------------------------
  // Stats calculation
  // -------------------------------------------------------------------------

  describe("stats calculation", () => {
    it("reports correct total_users from count query", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.stats.total_users).toBe(55);
    });

    it("defaults total_users to 0 when count is null", async () => {
      setResult(mockUsersBuilder, { count: null, error: null });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.stats.total_users).toBe(0);
    });

    it("counts organizations by approval_status", async () => {
      setResult(mockOrgStatusBuilder, {
        data: [
          APPROVED_ORG_STATUS,
          APPROVED_ORG_STATUS,
          APPROVED_ORG_STATUS,
          PENDING_ORG_STATUS,
          PENDING_ORG_STATUS,
          REJECTED_ORG_STATUS,
        ],
        error: null,
      });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.stats.organizations.total).toBe(6);
      expect(data.stats.organizations.approved).toBe(3);
      expect(data.stats.organizations.pending).toBe(2);
      expect(data.stats.organizations.rejected).toBe(1);
    });

    it("counts tournaments by status", async () => {
      setResult(mockTourStatusBuilder, {
        data: [
          PUBLISHED_TOUR_STATUS,
          PUBLISHED_TOUR_STATUS,
          DRAFT_TOUR_STATUS,
          CANCELLED_TOUR_STATUS,
        ],
        error: null,
      });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.stats.tournaments.total).toBe(4);
      expect(data.stats.tournaments.published).toBe(2);
      expect(data.stats.tournaments.draft).toBe(1);
      expect(data.stats.tournaments.cancelled).toBe(1);
    });

    it("reports correct total_registrations", async () => {
      setResult(mockRegCountBuilder, { count: 42, error: null });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.stats.total_registrations).toBe(42);
    });

    it("defaults total_registrations to 0 when count is null", async () => {
      setResult(mockRegCountBuilder, { count: null, error: null });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.stats.total_registrations).toBe(0);
    });

    it("sums effective_platform_fee_cents for platform_revenue_cents", async () => {
      setResult(mockPayoutBuilder, {
        data: [
          { effective_platform_fee_cents: 10000 },
          { effective_platform_fee_cents: 5000 },
          { effective_platform_fee_cents: 3000 },
        ],
        error: null,
      });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.stats.platform_revenue_cents).toBe(18000);
    });

    it("returns 0 for platform_revenue_cents when no payout records", async () => {
      setResult(mockPayoutBuilder, { data: [], error: null });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.stats.platform_revenue_cents).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Pending organizations
  // -------------------------------------------------------------------------

  describe("pending_organizations", () => {
    it("returns pending organizations with correct fields", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.pending_organizations).toHaveLength(1);
      expect(data.pending_organizations[0].id).toBe(ORG_ID_2);
      expect(data.pending_organizations[0].name).toBe("New Chess Club");
      expect(data.pending_organizations[0].email).toBe("newclub@example.com");
    });

    it("returns empty array when no orgs are pending", async () => {
      setResult(mockPendingOrgsBuilder, { data: [], error: null });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.pending_organizations).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Recent tournaments
  // -------------------------------------------------------------------------

  describe("recent_tournaments", () => {
    it("returns recent tournaments with organization_name resolved", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      const t = data.recent_tournaments.find(
        (r: { id: string }) => r.id === TOUR_ID_1,
      );
      expect(t.organization_name).toBe("KL Chess Association");
    });

    it("counts current_participants for recent tournaments", async () => {
      setResult(mockRecentRegsBuilder, {
        data: [
          { tournament_id: TOUR_ID_1 },
          { tournament_id: TOUR_ID_1 },
          { tournament_id: TOUR_ID_1 },
        ],
        error: null,
      });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      const t = data.recent_tournaments.find(
        (r: { id: string }) => r.id === TOUR_ID_1,
      );
      expect(t.current_participants).toBe(3);
    });

    it("defaults current_participants to 0 when no confirmed registrations", async () => {
      setResult(mockRecentRegsBuilder, { data: [], error: null });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.recent_tournaments[0].current_participants).toBe(0);
    });

    it("returns empty array when there are no tournaments", async () => {
      setResult(mockRecentToursBuilder, { data: [], error: null });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.recent_tournaments).toEqual([]);
    });

    it("sets organization_name to null when tournament has no organization_id", async () => {
      setResult(mockRecentToursBuilder, {
        data: [{ ...RECENT_TOUR_1, organization_id: null }],
        error: null,
      });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.recent_tournaments[0].organization_name).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("returns 500 when users query fails", async () => {
      setResult(mockUsersBuilder, { count: null, error: { message: "DB error" } });
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when organizations status query fails", async () => {
      setResult(mockOrgStatusBuilder, { data: null, error: { message: "DB error" } });
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when tournaments status query fails", async () => {
      setResult(mockTourStatusBuilder, { data: null, error: { message: "DB error" } });
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when registrations count query fails", async () => {
      setResult(mockRegCountBuilder, { count: null, error: { message: "DB error" } });
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when payout summary query fails", async () => {
      setResult(mockPayoutBuilder, { data: null, error: { message: "DB error" } });
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when pending orgs query fails", async () => {
      setResult(mockPendingOrgsBuilder, { data: null, error: { message: "DB error" } });
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when recent tournaments query fails", async () => {
      setResult(mockRecentToursBuilder, { data: null, error: { message: "DB error" } });
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when phase-2 registrations query fails", async () => {
      setResult(mockRecentRegsBuilder, { data: null, error: { message: "DB error" } });
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when has_global_permission RPC call fails", async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: "RPC error" } });
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // Query behaviour
  // -------------------------------------------------------------------------

  describe("query behaviour", () => {
    it("does not query registrations or org names when there are no recent tournaments", async () => {
      setResult(mockRecentToursBuilder, { data: [], error: null });
      vi.clearAllMocks();
      resetCallIndexes();
      setUser();
      setAdminPermission(true);
      setResult(mockUsersBuilder, { count: 0, error: null });
      setResult(mockOrgStatusBuilder, { data: [], error: null });
      setResult(mockTourStatusBuilder, { data: [], error: null });
      setResult(mockRegCountBuilder, { count: 0, error: null });
      setResult(mockPayoutBuilder, { data: [], error: null });
      setResult(mockPendingOrgsBuilder, { data: [], error: null });
      setResult(mockRecentToursBuilder, { data: [], error: null });
      await GET(makeRequest());
      const regInMock = mockRecentRegsBuilder.in as ReturnType<typeof vi.fn>;
      expect(regInMock).not.toHaveBeenCalled();
    });
  });
});
