import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOrgBuilder,
  mockMemberBuilder,
  mockTournamentsBuilder,
  mockPayoutBuilder,
  mockRegistrationsCountBuilder,
  mockRegistrationsListBuilder,
  mockFrom,
  mockGetClaims,
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

  const mockOrgBuilder = makeBuilder({ data: null, error: null });
  const mockMemberBuilder = makeBuilder({ count: 0, error: null });
  const mockTournamentsBuilder = makeBuilder({ data: [], error: null });
  const mockPayoutBuilder = makeBuilder({ data: [], error: null });
  // Two separate registrations builders: one for count, one for list.
  // The route calls registrations twice in parallel when there are tournaments.
  let regCallIndex = 0;
  const mockRegistrationsCountBuilder = makeBuilder({ count: 0, error: null });
  const mockRegistrationsListBuilder = makeBuilder({ data: [], error: null });

  const mockFrom = vi.fn((table: string) => {
    if (table === "organizations") return mockOrgBuilder;
    if (table === "organization_memberships") return mockMemberBuilder;
    if (table === "tournaments") return mockTournamentsBuilder;
    if (table === "tournament_payout_summary") return mockPayoutBuilder;
    if (table === "registrations") {
      // Alternate between count builder and list builder on successive calls
      return regCallIndex++ % 2 === 0
        ? mockRegistrationsCountBuilder
        : mockRegistrationsListBuilder;
    }
    return mockOrgBuilder;
  });

  // Reset regCallIndex via hoisted so tests can reset it
  (mockFrom as unknown as { _resetRegIndex: () => void })._resetRegIndex =
    () => {
      regCallIndex = 0;
    };

  const mockGetClaims = vi.fn();

  return {
    mockOrgBuilder,
    mockMemberBuilder,
    mockTournamentsBuilder,
    mockPayoutBuilder,
    mockRegistrationsCountBuilder,
    mockRegistrationsListBuilder,
    mockFrom,
    mockGetClaims,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
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

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TOUR_ID_1 = "cccccccc-0000-0000-0000-000000000001";
const TOUR_ID_2 = "cccccccc-0000-0000-0000-000000000002";

const OTHER_USER_ID = "aaaaaaaa-0000-0000-0000-000000000002";

const APPROVED_ORG = {
  id: ORG_ID,
  name: "KL Chess Association",
  approval_status: "approved",
  created_by: USER_ID,
};

const PUBLISHED_TOURNAMENT = {
  id: TOUR_ID_1,
  name: "KL Open Rapid 2026",
  start_date: "2026-03-15",
  max_participants: 120,
  status: "published",
};

const DRAFT_TOURNAMENT = {
  id: TOUR_ID_2,
  name: "KL Blitz 2026",
  start_date: "2026-06-01",
  max_participants: 60,
  status: "draft",
};

const PAYOUT_ROW = {
  net_revenue_cents: 100000,
  net_payout_cents: 90000,
};

function makeRequest(orgId: string = ORG_ID): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/dashboard`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setUser(id = USER_ID) {
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: id } },
    error: null,
  });
}

function setNoUser() {
  mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
}

function setOrgResult(data: unknown, error: unknown = null) {
  (mockOrgBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setMemberResult(count: number | null, error: unknown = null) {
  (mockMemberBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ count, error }).then(onfulfilled, onrejected);
}

function setTournamentsResult(data: unknown, error: unknown = null) {
  (mockTournamentsBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setPayoutResult(data: unknown, error: unknown = null) {
  (mockPayoutBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setRegistrationsCountResult(
  count: number | null,
  error: unknown = null,
) {
  (mockRegistrationsCountBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ count, error }).then(onfulfilled, onrejected);
}

function setRegistrationsListResult(data: unknown, error: unknown = null) {
  (mockRegistrationsListBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function resetRegCallIndex() {
  (mockFrom as unknown as { _resetRegIndex: () => void })._resetRegIndex();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/organizations/:orgId/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRegCallIndex();
    setUser();
    setOrgResult(APPROVED_ORG);
    setMemberResult(1);
    setTournamentsResult([PUBLISHED_TOURNAMENT]);
    setPayoutResult([PAYOUT_ROW]);
    setRegistrationsCountResult(5);
    setRegistrationsListResult([
      { tournament_id: TOUR_ID_1 },
      { tournament_id: TOUR_ID_1 },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  describe("validation", () => {
    it("returns 400 for a non-UUID orgId", async () => {
      const res = await GET(makeRequest("not-a-uuid"), {
        params: Promise.resolve({ orgId: "not-a-uuid" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/invalid organization id/i);
    });
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      setNoUser();
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe("authorization", () => {
    it("returns 404 when organization does not exist", async () => {
      setOrgResult(null, { code: "PGRST116", message: "No rows found" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 500 on org query error", async () => {
      setOrgResult(null, { code: "500", message: "DB error" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 on membership query error", async () => {
      setMemberResult(null, { message: "DB error" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 403 when organization is not approved", async () => {
      setOrgResult({ ...APPROVED_ORG, approval_status: "pending" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/not approved/i);
    });

    it("returns 403 when org is rejected", async () => {
      setOrgResult({ ...APPROVED_ORG, approval_status: "rejected" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 403 when user is not a member and not the creator", async () => {
      setOrgResult({ ...APPROVED_ORG, created_by: OTHER_USER_ID });
      setMemberResult(0);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/access denied/i);
    });

    it("returns 403 when member count is null and user is not the creator", async () => {
      setOrgResult({ ...APPROVED_ORG, created_by: OTHER_USER_ID });
      setMemberResult(null);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 403 when user is the creator but has no membership row", async () => {
      setMemberResult(0);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe("response shape", () => {
    it("returns 200 with data object containing organization, stats, and recent_tournaments", async () => {
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty("data");
      expect(json.data).toHaveProperty("organization");
      expect(json.data).toHaveProperty("stats");
      expect(json.data).toHaveProperty("recent_tournaments");
    });

    it("includes organization id, name, and approval_status", async () => {
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.organization.id).toBe(ORG_ID);
      expect(data.organization.name).toBe("KL Chess Association");
      expect(data.organization.approval_status).toBe("approved");
    });

    it("includes all four stats fields", async () => {
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.stats).toHaveProperty("active_tournaments");
      expect(data.stats).toHaveProperty("total_registrations");
      expect(data.stats).toHaveProperty("total_revenue_cents");
      expect(data.stats).toHaveProperty("pending_payout_cents");
    });

    it("shapes each recent_tournament correctly", async () => {
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(Array.isArray(data.recent_tournaments)).toBe(true);
      const t = data.recent_tournaments[0];
      expect(t).toHaveProperty("id");
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("start_date");
      expect(t).toHaveProperty("current_participants");
      expect(t).toHaveProperty("max_participants");
      expect(t).toHaveProperty("status");
    });
  });

  // -------------------------------------------------------------------------
  // Stats calculation
  // -------------------------------------------------------------------------

  describe("stats calculation", () => {
    it("counts only published tournaments as active", async () => {
      setTournamentsResult([PUBLISHED_TOURNAMENT, DRAFT_TOURNAMENT]);
      resetRegCallIndex();
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.stats.active_tournaments).toBe(1);
    });

    it("reports 0 active tournaments when all are drafts", async () => {
      setTournamentsResult([DRAFT_TOURNAMENT]);
      resetRegCallIndex();
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.stats.active_tournaments).toBe(0);
    });

    it("uses the registration count for total_registrations", async () => {
      setRegistrationsCountResult(42);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.stats.total_registrations).toBe(42);
    });

    it("defaults total_registrations to 0 when count is null", async () => {
      setRegistrationsCountResult(null);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.stats.total_registrations).toBe(0);
    });

    it("sums net_revenue_cents from payout summary for revenue", async () => {
      setPayoutResult([
        { net_revenue_cents: 50000, net_payout_cents: 45000 },
        { net_revenue_cents: 30000, net_payout_cents: 27000 },
      ]);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.stats.total_revenue_cents).toBe(80000);
    });

    it("sums net_payout_cents from payout summary for pending_payout", async () => {
      setPayoutResult([
        { net_revenue_cents: 50000, net_payout_cents: 45000 },
        { net_revenue_cents: 30000, net_payout_cents: 27000 },
      ]);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.stats.pending_payout_cents).toBe(72000);
    });

    it("returns 0 for revenue and payout when there are no payment records", async () => {
      setPayoutResult([]);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.stats.total_revenue_cents).toBe(0);
      expect(data.stats.pending_payout_cents).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Recent tournaments
  // -------------------------------------------------------------------------

  describe("recent_tournaments", () => {
    it("returns at most 5 recent tournaments", async () => {
      const manyTournaments = Array.from({ length: 8 }, (_, i) => ({
        id: `cccccccc-0000-0000-0000-00000000000${i + 1}`,
        name: `Tournament ${i + 1}`,
        start_date: "2026-03-15",
        max_participants: 120,
        status: "published",
      }));
      setTournamentsResult(manyTournaments);
      resetRegCallIndex();
      setRegistrationsListResult([]);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.recent_tournaments).toHaveLength(5);
    });

    it("returns empty array when org has no tournaments", async () => {
      setTournamentsResult([]);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.recent_tournaments).toEqual([]);
      expect(data.stats.total_registrations).toBe(0);
    });

    it("counts current_participants for recent tournaments", async () => {
      setRegistrationsListResult([
        { tournament_id: TOUR_ID_1 },
        { tournament_id: TOUR_ID_1 },
        { tournament_id: TOUR_ID_1 },
      ]);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      const t = data.recent_tournaments.find(
        (r: { id: string }) => r.id === TOUR_ID_1,
      );
      expect(t.current_participants).toBe(3);
    });

    it("defaults current_participants to 0 when no confirmed registrations", async () => {
      setRegistrationsListResult([]);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data.recent_tournaments[0].current_participants).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling — data fetch phase
  // -------------------------------------------------------------------------

  describe("error handling — data fetch", () => {
    it("returns 500 when tournaments query fails", async () => {
      setTournamentsResult(null, { message: "DB error" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when payout summary query fails", async () => {
      setPayoutResult(null, { message: "DB error" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // Query behaviour
  // -------------------------------------------------------------------------

  describe("query behaviour", () => {
    it("filters tournaments by organization_id", async () => {
      await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const eqMock = mockTournamentsBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("organization_id", ORG_ID);
    });

    it("filters membership by organization_id and user_id", async () => {
      await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const eqMock = mockMemberBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("organization_id", ORG_ID);
      expect(eqMock).toHaveBeenCalledWith("user_id", appIdFor(USER_ID));
    });

    it("filters payout summary by organization_id", async () => {
      await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const eqMock = mockPayoutBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("organization_id", ORG_ID);
    });

    it("does not query registrations when org has no tournaments", async () => {
      setTournamentsResult([]);
      vi.clearAllMocks();
      // Re-set the required mocks after clearAllMocks
      setUser();
      setOrgResult(APPROVED_ORG);
      setMemberResult(1);
      setTournamentsResult([]);
      setPayoutResult([]);
      await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      // registrations builder should not have been called
      const regInMock = mockRegistrationsCountBuilder.in as ReturnType<
        typeof vi.fn
      >;
      expect(regInMock).not.toHaveBeenCalled();
    });
  });
});
