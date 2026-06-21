import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOrgBuilder,
  mockMembershipBuilder,
  mockTournamentBuilder,
  mockRegistrationsBuilder,
  mockUsersBuilder,
  mockProfilesBuilder,
  mockFrom,
  mockGetUser,
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
      "insert",
      "update",
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
  const mockMembershipBuilder = makeBuilder({ data: null, error: null });
  const mockTournamentBuilder = makeBuilder({ data: null, error: null });
  const mockRegistrationsBuilder = makeBuilder({ data: null, error: null });
  const mockUsersBuilder = makeBuilder({ data: null, error: null });
  const mockProfilesBuilder = makeBuilder({ data: null, error: null });

  const mockFrom = vi.fn((table: string) => {
    switch (table) {
      case "organizations":
        return mockOrgBuilder;
      case "organization_memberships":
        return mockMembershipBuilder;
      case "tournaments":
        return mockTournamentBuilder;
      case "registrations":
        return mockRegistrationsBuilder;
      case "users":
        return mockUsersBuilder;
      case "player_profiles":
        return mockProfilesBuilder;
      default:
        return mockOrgBuilder;
    }
  });

  const mockGetUser = vi.fn();

  return {
    mockOrgBuilder,
    mockMembershipBuilder,
    mockTournamentBuilder,
    mockRegistrationsBuilder,
    mockUsersBuilder,
    mockProfilesBuilder,
    mockFrom,
    mockGetUser,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

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

import { GET } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TOUR_ID = "cccccccc-0000-0000-0000-000000000001";
const MEMBER_USER_ID = "aaaaaaaa-0000-0000-0000-000000000002";

const APPROVED_ORG = {
  id: ORG_ID,
  approval_status: "approved",
  created_by: USER_ID,
};

const TOURNAMENT_DATA = {
  id: TOUR_ID,
  name: "Test Tournament",
  description: null,
  status: "published",
  start_date: "2026-09-01",
  end_date: "2026-09-02",
  registration_deadline: "2026-08-25T23:59:59Z",
  venue_name: "KL Convention Centre",
  venue_state: "W.P. Kuala Lumpur",
  venue_address: "Jalan Pinang",
  format: { type: "rapid", system: "swiss", rounds: 7 },
  time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 0 },
  is_fide_rated: true,
  is_mcf_rated: false,
  max_participants: 64,
  entry_fees: { standard: { amount_cents: 5000 } },
  prizes: null,
  restrictions: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setResult(
  builder: Record<string, unknown>,
  data: unknown,
  error: unknown = null,
) {
  builder.then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setUser(id = USER_ID) {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
}

function setNoUser() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

function makeRequest(orgId = ORG_ID, id = TOUR_ID): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/tournaments/${id}`,
    { method: "GET" },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  setUser();
  setResult(mockOrgBuilder, APPROVED_ORG);
  setResult(mockMembershipBuilder, { roles: { name: "owner" } });
  setResult(mockTournamentBuilder, TOURNAMENT_DATA);
  setResult(mockRegistrationsBuilder, []);
  setResult(mockUsersBuilder, []);
  setResult(mockProfilesBuilder, []);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/organizations/[orgId]/tournaments/[id]", () => {
  describe("input validation", () => {
    it("returns 400 for invalid orgId format", async () => {
      const res = await GET(makeRequest("not-a-uuid"), {
        params: Promise.resolve({ orgId: "not-a-uuid", id: TOUR_ID }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid tournament ID format", async () => {
      const res = await GET(makeRequest(ORG_ID, "not-a-uuid"), {
        params: Promise.resolve({ orgId: ORG_ID, id: "not-a-uuid" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      setNoUser();
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("organization checks", () => {
    it("returns 404 when organization does not exist", async () => {
      setResult(mockOrgBuilder, null, {
        code: "PGRST116",
        message: "Not found",
      });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 500 when org query fails with a generic DB error", async () => {
      setResult(mockOrgBuilder, null, {
        code: "DB_ERROR",
        message: "Connection failed",
      });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 403 when organization is not approved", async () => {
      setResult(mockOrgBuilder, {
        ...APPROVED_ORG,
        approval_status: "pending",
      });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("permission checks", () => {
    it("allows the org creator to view a tournament", async () => {
      setUser(USER_ID);
      setResult(mockOrgBuilder, { ...APPROVED_ORG, created_by: USER_ID });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
    });

    it("allows an org admin member to view a tournament", async () => {
      setUser(MEMBER_USER_ID);
      setResult(mockOrgBuilder, { ...APPROVED_ORG, created_by: USER_ID });
      setResult(mockMembershipBuilder, { roles: { name: "admin" } });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
    });

    it("returns 403 for a non-member user", async () => {
      setUser(MEMBER_USER_ID);
      setResult(mockOrgBuilder, { ...APPROVED_ORG, created_by: USER_ID });
      setResult(mockMembershipBuilder, null, {
        code: "PGRST116",
        message: "Not found",
      });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 403 for a member-role user", async () => {
      setUser(MEMBER_USER_ID);
      setResult(mockOrgBuilder, { ...APPROVED_ORG, created_by: USER_ID });
      setResult(mockMembershipBuilder, { roles: { name: "member" } });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("tournament fetch", () => {
    it("returns 404 when tournament does not exist", async () => {
      setResult(mockTournamentBuilder, null, {
        code: "PGRST116",
        message: "Not found",
      });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 500 when tournament query fails with a generic DB error", async () => {
      setResult(mockTournamentBuilder, null, {
        code: "DB_ERROR",
        message: "Connection timeout",
      });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("registrations query", () => {
    it("returns 500 when registrations query fails", async () => {
      setResult(mockRegistrationsBuilder, null, { message: "DB error" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 200 with empty participants and zero stats when no registrations", async () => {
      setResult(mockRegistrationsBuilder, []);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.participants).toEqual([]);
      expect(body.data.stats.total).toBe(0);
      expect(body.data.stats.confirmed).toBe(0);
      expect(body.data.stats.pending).toBe(0);
    });
  });

  describe("successful response", () => {
    it("returns correct tournament structure with venue and format", async () => {
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const t = body.data.tournament;
      expect(t.id).toBe(TOUR_ID);
      expect(t.name).toBe("Test Tournament");
      expect(t.venue.name).toBe("KL Convention Centre");
      expect(t.venue.state).toBe("W.P. Kuala Lumpur");
      expect(t.venue.address).toBe("Jalan Pinang");
      expect(t.is_fide_rated).toBe(true);
      expect(t.prizes).toBeNull();
    });

    it("returns participants with resolved user names and ratings", async () => {
      setResult(mockRegistrationsBuilder, [
        {
          id: "reg-1",
          user_id: "u1",
          fee_tier: "standard",
          status: "confirmed",
          registered_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "reg-2",
          user_id: "u2",
          fee_tier: "early_bird",
          status: "pending_payment",
          registered_at: "2026-01-02T00:00:00Z",
        },
      ]);
      setResult(mockUsersBuilder, [
        { id: "u1", first_name: "Alice", last_name: "Wong" },
        { id: "u2", first_name: "Bob", last_name: "Lee" },
      ]);
      setResult(mockProfilesBuilder, [
        {
          user_id: "u1",
          fide_id: 1234567,
          fide_rating: { rapid: 1800 },
          national_rating: null,
        },
        {
          user_id: "u2",
          fide_id: null,
          fide_rating: null,
          national_rating: 1400,
        },
      ]);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.participants).toHaveLength(2);
      expect(body.data.participants[0].name).toBe("Alice Wong");
      expect(body.data.participants[0].rating).toBe(1800);
      expect(body.data.participants[1].name).toBe("Bob Lee");
      expect(body.data.stats.total).toBe(2);
      expect(body.data.stats.confirmed).toBe(1);
      expect(body.data.stats.pending).toBe(1);
    });

    it("uses blitz rating when tournament format is blitz", async () => {
      setResult(mockTournamentBuilder, {
        ...TOURNAMENT_DATA,
        format: { type: "blitz", system: "swiss", rounds: 9 },
      });
      setResult(mockRegistrationsBuilder, [
        {
          id: "reg-1",
          user_id: "u1",
          fee_tier: "standard",
          status: "confirmed",
          registered_at: "2026-01-01T00:00:00Z",
        },
      ]);
      setResult(mockUsersBuilder, [
        { id: "u1", first_name: "Alice", last_name: "Wong" },
      ]);
      setResult(mockProfilesBuilder, [
        {
          user_id: "u1",
          fide_id: null,
          fide_rating: { blitz: 1600, rapid: 1700, standard: 1750 },
          national_rating: null,
        },
      ]);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.participants[0].rating).toBe(1600);
    });

    it("falls back to rapid when blitz format has no blitz rating", async () => {
      setResult(mockTournamentBuilder, {
        ...TOURNAMENT_DATA,
        format: { type: "blitz", system: "swiss", rounds: 9 },
      });
      setResult(mockRegistrationsBuilder, [
        {
          id: "reg-1",
          user_id: "u1",
          fee_tier: "standard",
          status: "confirmed",
          registered_at: "2026-01-01T00:00:00Z",
        },
      ]);
      setResult(mockUsersBuilder, [
        { id: "u1", first_name: "Alice", last_name: "Wong" },
      ]);
      setResult(mockProfilesBuilder, [
        {
          user_id: "u1",
          fide_id: null,
          fide_rating: { rapid: 1700 },
          national_rating: null,
        },
      ]);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.participants[0].rating).toBe(1700);
    });

    it("uses standard rating when tournament format is classical", async () => {
      setResult(mockTournamentBuilder, {
        ...TOURNAMENT_DATA,
        format: { type: "classical", system: "swiss", rounds: 9 },
      });
      setResult(mockRegistrationsBuilder, [
        {
          id: "reg-1",
          user_id: "u1",
          fee_tier: "standard",
          status: "confirmed",
          registered_at: "2026-01-01T00:00:00Z",
        },
      ]);
      setResult(mockUsersBuilder, [
        { id: "u1", first_name: "Alice", last_name: "Wong" },
      ]);
      setResult(mockProfilesBuilder, [
        {
          user_id: "u1",
          fide_id: 9876543,
          fide_rating: { standard: 2000 },
          national_rating: null,
        },
      ]);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.participants[0].rating).toBe(2000);
    });

    it("falls back to rapid when rapid format has no rapid rating", async () => {
      setResult(mockRegistrationsBuilder, [
        {
          id: "reg-1",
          user_id: "u1",
          fee_tier: "standard",
          status: "confirmed",
          registered_at: "2026-01-01T00:00:00Z",
        },
      ]);
      setResult(mockUsersBuilder, [
        { id: "u1", first_name: "Alice", last_name: "Wong" },
      ]);
      setResult(mockProfilesBuilder, [
        {
          user_id: "u1",
          fide_id: null,
          fide_rating: { standard: 1900 },
          national_rating: null,
        },
      ]);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.participants[0].rating).toBe(1900);
    });

    it("returns null rating when player has no fide_rating", async () => {
      setResult(mockRegistrationsBuilder, [
        {
          id: "reg-1",
          user_id: "u1",
          fee_tier: "standard",
          status: "confirmed",
          registered_at: "2026-01-01T00:00:00Z",
        },
      ]);
      setResult(mockUsersBuilder, [
        { id: "u1", first_name: "Alice", last_name: "Wong" },
      ]);
      setResult(mockProfilesBuilder, [
        {
          user_id: "u1",
          fide_id: null,
          fide_rating: null,
          national_rating: null,
        },
      ]);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.participants[0].rating).toBeNull();
    });

    it("shows 'Unknown' name when user is not found in users table", async () => {
      setResult(mockRegistrationsBuilder, [
        {
          id: "reg-1",
          user_id: "missing-user",
          fee_tier: "standard",
          status: "confirmed",
          registered_at: "2026-01-01T00:00:00Z",
        },
      ]);
      setResult(mockUsersBuilder, []);
      setResult(mockProfilesBuilder, []);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.participants[0].name).toBe("Unknown");
    });

    it("handles tournament with null format gracefully", async () => {
      setResult(mockTournamentBuilder, { ...TOURNAMENT_DATA, format: null });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.tournament.format).toBeNull();
    });

    it("includes correct participant index ordering", async () => {
      setResult(mockRegistrationsBuilder, [
        {
          id: "reg-1",
          user_id: "u1",
          fee_tier: "standard",
          status: "confirmed",
          registered_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "reg-2",
          user_id: "u2",
          fee_tier: "standard",
          status: "confirmed",
          registered_at: "2026-01-02T00:00:00Z",
        },
      ]);
      setResult(mockUsersBuilder, [
        { id: "u1", first_name: "Alice", last_name: "Wong" },
        { id: "u2", first_name: "Bob", last_name: "Lee" },
      ]);
      setResult(mockProfilesBuilder, []);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.participants[0].index).toBe(1);
      expect(body.data.participants[1].index).toBe(2);
    });
  });
});
