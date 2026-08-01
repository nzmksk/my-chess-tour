import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getTodayInTimeZone } from "@/lib/datetime";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOrgBuilder,
  mockMembershipBuilder,
  mockTournamentFetchBuilder,
  mockTournamentUpdateBuilder,
  mockPaymentsBuilder,
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
  const mockTournamentFetchBuilder = makeBuilder({ data: null, error: null });
  const mockTournamentUpdateBuilder = makeBuilder({ data: null, error: null });
  // Paid-registration probe for the money-field freeze. count 0 = nobody has
  // paid yet, so money fields stay editable.
  const mockPaymentsBuilder = makeBuilder({ count: 0, error: null });

  // Track tournament table calls: first is fetch, second is update
  let tournamentCallIndex = 0;

  const mockFrom = vi.fn((table: string) => {
    if (table === "organizations") return mockOrgBuilder;
    if (table === "organization_memberships") return mockMembershipBuilder;
    if (table === "payments") return mockPaymentsBuilder;
    if (table === "tournaments") {
      const builder =
        tournamentCallIndex === 0
          ? mockTournamentFetchBuilder
          : mockTournamentUpdateBuilder;
      tournamentCallIndex += 1;
      return builder;
    }
    return mockOrgBuilder;
  });

  (
    mockFrom as unknown as { _resetTournamentCallIndex: () => void }
  )._resetTournamentCallIndex = () => {
    tournamentCallIndex = 0;
  };

  const mockGetClaims = vi.fn();

  return {
    mockOrgBuilder,
    mockMembershipBuilder,
    mockTournamentFetchBuilder,
    mockTournamentUpdateBuilder,
    mockPaymentsBuilder,
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

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { PATCH } from "../route";

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

// A far-future draft: exempt from both freeze stages, so it exercises the
// pre-freeze behaviour every other test relied on before the freeze existed.
const EXISTING_TOURNAMENT = {
  id: TOUR_ID,
  status: "draft",
  registration_deadline: "2099-08-01T00:00:00Z",
  registration_closed_at: null,
  start_date: "2099-09-01",
  end_date: "2099-09-02",
  timezone: "Asia/Kuala_Lumpur",
  // The money columns the freeze compares against. Shaped exactly as the PATCH
  // route writes them, because that is what a row edited through this route
  // actually holds — and an unchanged resend has to compare equal to it.
  entry_fees: { standard: { amount_cents: 4000 }, additional: [] },
  prizes: null,
  max_participants: 32,
  commission_rate: 10,
  organizer_commission_pct: 0,
};

const UPDATED_TOURNAMENT = {
  id: TOUR_ID,
  name: "Updated Tournament Name",
  status: "draft",
  updated_at: "2026-05-26T12:00:00Z",
};

const VALID_PATCH_BODY = {
  name: "Updated Tournament Name",
  venue_name: "KLCC Convention Centre",
  venue_state: "Kuala Lumpur",
  venue_address: "Jalan Pinang, 50088 KL",
  format: { type: "rapid", system: "swiss", rounds: 9 },
  time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 0 },
  start_date: "2026-09-01",
  end_date: "2026-09-02",
  registration_deadline: "2026-08-25T23:59:59Z",
  max_participants: 64,
  is_fide_rated: true,
  is_mcf_rated: true,
  entry_fees: {
    standard: { amount_cents: 6000 },
    additional: [],
  },
};

function makeRequest(
  orgId: string = ORG_ID,
  id: string = TOUR_ID,
  body: unknown = VALID_PATCH_BODY,
): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/tournaments/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
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

function setMembershipResult(data: unknown, error: unknown = null) {
  (mockMembershipBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setTournamentFetchResult(data: unknown, error: unknown = null) {
  (mockTournamentFetchBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setTournamentUpdateResult(data: unknown, error: unknown = null) {
  (mockTournamentUpdateBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

/** How many paid registration payments the money-field freeze should see. */
function setPaidRegistrationCount(count: number, error: unknown = null) {
  (mockPaymentsBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ count, error }).then(onfulfilled, onrejected);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  (
    mockFrom as unknown as { _resetTournamentCallIndex: () => void }
  )._resetTournamentCallIndex();
  setOrgResult(APPROVED_ORG);
  setMembershipResult({ roles: { name: "owner" } });
  setTournamentFetchResult(EXISTING_TOURNAMENT);
  setTournamentUpdateResult(UPDATED_TOURNAMENT);
  setPaidRegistrationCount(0);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/v1/organizations/[orgId]/tournaments/[id]", () => {
  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      setNoUser();
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("input validation", () => {
    it("returns 400 for invalid orgId format", async () => {
      setUser();
      const res = await PATCH(makeRequest("not-a-uuid", TOUR_ID), {
        params: Promise.resolve({ orgId: "not-a-uuid", id: TOUR_ID }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid tournament ID format", async () => {
      setUser();
      const res = await PATCH(makeRequest(ORG_ID, "not-a-uuid"), {
        params: Promise.resolve({ orgId: ORG_ID, id: "not-a-uuid" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid JSON body", async () => {
      setUser();
      const req = new NextRequest(
        `http://localhost/api/v1/organizations/${ORG_ID}/tournaments/${TOUR_ID}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: "not-json",
        },
      );
      const res = await PATCH(req, {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when name is explicitly set to empty string", async () => {
      setUser();
      const res = await PATCH(makeRequest(ORG_ID, TOUR_ID, { name: "" }), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toMatch(/name/i);
    });

    it("returns 400 when no fields are provided", async () => {
      setUser();
      const res = await PATCH(makeRequest(ORG_ID, TOUR_ID, {}), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toMatch(/no fields/i);
    });
  });

  describe("organization checks", () => {
    it("returns 404 when organization does not exist", async () => {
      setUser();
      setOrgResult(null, { code: "PGRST116", message: "Not found" });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 403 when organization is not approved", async () => {
      setUser();
      setOrgResult({ ...APPROVED_ORG, approval_status: "pending" });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("permission checks", () => {
    it("allows the org creator to update a tournament", async () => {
      setUser(USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
    });

    it("allows an org admin member to update a tournament", async () => {
      setUser(MEMBER_USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      setMembershipResult({ roles: { name: "admin" } });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
    });

    it("allows an org owner member to update a tournament", async () => {
      setUser(MEMBER_USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      setMembershipResult({ roles: { name: "owner" } });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
    });

    it("returns 403 for a member-role user", async () => {
      setUser(MEMBER_USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      setMembershipResult({ roles: { name: "member" } });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("returns 403 for a non-member user", async () => {
      setUser(MEMBER_USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      setMembershipResult(null, { code: "PGRST116", message: "Not found" });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("tournament checks", () => {
    it("returns 404 when tournament does not exist", async () => {
      setUser();
      setTournamentFetchResult(null, {
        code: "PGRST116",
        message: "Not found",
      });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 when tournament belongs to a different org", async () => {
      setUser();
      setTournamentFetchResult(null, {
        code: "PGRST116",
        message: "Not found",
      });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("partial updates", () => {
    it("allows updating only the name", async () => {
      setUser();
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, { name: "New Name Only" }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });

    it("allows updating entry fees only", async () => {
      setUser();
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          entry_fees: { standard: { amount_cents: 3000 }, additional: [] },
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });

    it("allows updating prizes to null", async () => {
      setUser();
      const res = await PATCH(makeRequest(ORG_ID, TOUR_ID, { prizes: null }), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
    });

    it("allows updating restrictions to empty array", async () => {
      setUser();
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, { restrictions: [] }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });
  });

  describe("successful update", () => {
    it("returns 200 with the updated tournament data", async () => {
      setUser();
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(TOUR_ID);
      expect(body.data.name).toBe("Updated Tournament Name");
      expect(body.data.status).toBe("draft");
      expect(body.data.updated_at).toBeDefined();
    });

    it("works for a published tournament that has not started yet", async () => {
      setUser();
      setTournamentFetchResult({
        ...EXISTING_TOURNAMENT,
        status: "published",
      });
      setTournamentUpdateResult({ ...UPDATED_TOURNAMENT, status: "published" });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe("published");
    });

    it("syncs registration_closed_at to the new deadline when not closed early", async () => {
      setUser();
      // Published, closed_at still tracks the deadline (never closed early).
      setTournamentFetchResult({
        ...EXISTING_TOURNAMENT,
        status: "published",
        registration_deadline: "2026-08-01T00:00:00Z",
        registration_closed_at: "2026-08-01T00:00:00Z",
      });
      setTournamentUpdateResult({ ...UPDATED_TOURNAMENT, status: "published" });
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          registration_deadline: "2026-08-25T23:59:59Z",
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
      expect(mockTournamentUpdateBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          registration_deadline: "2026-08-25T23:59:59Z",
          registration_closed_at: "2026-08-25T23:59:59Z",
        }),
      );
    });

    it("leaves registration_closed_at untouched when already closed early", async () => {
      setUser();
      // Published and closed early (closed_at < deadline) → deadline edits must
      // not resurrect/move the irreversible early-close timestamp.
      setTournamentFetchResult({
        ...EXISTING_TOURNAMENT,
        status: "published",
        registration_deadline: "2026-08-01T00:00:00Z",
        registration_closed_at: "2026-07-01T00:00:00Z",
      });
      setTournamentUpdateResult({ ...UPDATED_TOURNAMENT, status: "published" });
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          registration_deadline: "2026-08-25T23:59:59Z",
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
      expect(mockTournamentUpdateBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          registration_deadline: "2026-08-25T23:59:59Z",
        }),
      );
      expect(mockTournamentUpdateBuilder.update).toHaveBeenCalledWith(
        expect.not.objectContaining({
          registration_closed_at: expect.anything(),
        }),
      );
    });
  });

  // Two-stage freeze: money fields lock at the first paid registration,
  // everything locks once the tournament starts.
  describe("edit freeze", () => {
    const PUBLISHED = { ...EXISTING_TOURNAMENT, status: "published" };
    // Deliberately in the past so the date-derived state is "completed"
    // regardless of when the suite runs.
    const STARTED = {
      ...PUBLISHED,
      start_date: "2020-01-01",
      end_date: "2020-01-02",
    };
    // "Today" must be resolved in the SAME timezone the route uses. Building it
    // from toISOString() (UTC) makes this test fail for the eight hours a day
    // when the UTC date is a day behind Kuala Lumpur's — the exact class of bug
    // the timezone column exists to prevent.
    const ONGOING_TODAY = (() => {
      const today = getTodayInTimeZone(PUBLISHED.timezone);
      return { ...PUBLISHED, start_date: today, end_date: today };
    })();

    it("allows money-field edits before anyone has paid", async () => {
      setUser();
      setTournamentFetchResult(PUBLISHED);
      setTournamentUpdateResult({ ...UPDATED_TOURNAMENT, status: "published" });
      setPaidRegistrationCount(0);
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          entry_fees: { standard: { amount_cents: 5000 } },
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });

    it("409s on a money-field edit once a registration is paid", async () => {
      setUser();
      setTournamentFetchResult(PUBLISHED);
      setPaidRegistrationCount(1);
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          prizes: { categories: [] },
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
      // The organizer needs to know WHICH field was refused.
      expect(body.error.details).toContain("prizes");
    });

    it("still allows non-money edits after a registration is paid", async () => {
      setUser();
      setTournamentFetchResult(PUBLISHED);
      setTournamentUpdateResult({ ...UPDATED_TOURNAMENT, status: "published" });
      setPaidRegistrationCount(1);
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, { venue_address: "2 New Road" }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });

    // The edit wizard rebuilds the entire draft body on every save, so it always
    // resends entry_fees and max_participants even when the organizer only
    // touched the venue. Refusing that is a false 409: the trigger compares
    // OLD/NEW and would have let it through. This is the payload the client
    // actually sends, not a hand-trimmed one.
    it("allows a venue edit that resends money fields unchanged", async () => {
      setUser();
      setTournamentFetchResult(PUBLISHED);
      setTournamentUpdateResult({ ...UPDATED_TOURNAMENT, status: "published" });
      setPaidRegistrationCount(1);
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          venue_address: "2 New Road",
          entry_fees: PUBLISHED.entry_fees,
          max_participants: PUBLISHED.max_participants,
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });

    // jsonb equality ignores key order, so the freeze must too — otherwise the
    // check would depend on how the client happened to serialise the object.
    it("ignores key order when deciding a money field is unchanged", async () => {
      setUser();
      setTournamentFetchResult(PUBLISHED);
      setTournamentUpdateResult({ ...UPDATED_TOURNAMENT, status: "published" });
      setPaidRegistrationCount(1);
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          entry_fees: { additional: [], standard: { amount_cents: 4000 } },
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });

    it("409s when a resent money field differs by even one cent", async () => {
      setUser();
      setTournamentFetchResult(PUBLISHED);
      setPaidRegistrationCount(1);
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          venue_address: "2 New Road",
          entry_fees: { standard: { amount_cents: 4001 }, additional: [] },
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.details).toEqual(["entry_fees"]);
    });

    it("409s on any edit once the tournament has started", async () => {
      setUser();
      setTournamentFetchResult(ONGOING_TODAY);
      setPaidRegistrationCount(0);
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, { venue_address: "2 New Road" }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.message).toMatch(/started/i);
    });

    it("409s on any edit once the tournament has ended", async () => {
      setUser();
      setTournamentFetchResult(STARTED);
      setPaidRegistrationCount(0);
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, { venue_address: "2 New Road" }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.message).toMatch(/ended/i);
    });

    it("exempts drafts from both stages", async () => {
      setUser();
      // A draft carries placeholder dates that are already "past" by the
      // date-derived rule; freezing on that would make drafts uneditable.
      setTournamentFetchResult({
        ...EXISTING_TOURNAMENT,
        start_date: "2020-01-01",
        end_date: "2020-01-02",
      });
      setPaidRegistrationCount(1);
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          entry_fees: { standard: { amount_cents: 5000 } },
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });
  });

  describe("database errors", () => {
    it("returns 500 when the update fails", async () => {
      setUser();
      setTournamentUpdateResult(null, { message: "DB constraint violation" });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when the org query fails with a generic DB error", async () => {
      setUser();
      setOrgResult(null, { code: "DB_ERROR", message: "Connection timeout" });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when the tournament fetch fails with a generic DB error", async () => {
      setUser();
      setTournamentFetchResult(null, {
        code: "DB_ERROR",
        message: "Query timeout",
      });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("field-level patch branches", () => {
    it("patches description with a non-empty string", async () => {
      setUser();
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, { description: "Updated description." }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });

    it("sets description to null when provided as empty string", async () => {
      setUser();
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, { description: "" }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });

    it("patches prizes with non-null categories and special prizes", async () => {
      setUser();
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          prizes: {
            categories: [
              {
                name: "Open",
                entries: [{ place: "1st", amount_cents: 100000 }],
              },
            ],
            special: [{ name: "Best Game", amount_cents: 20000 }],
          },
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });

    it("patches restrictions with a non-empty array", async () => {
      setUser();
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          restrictions: [{ type: "Max Rating", value: "2000" }],
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });

    it("patches entry_fees with additional tiers", async () => {
      setUser();
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, {
          entry_fees: {
            standard: { amount_cents: 5000 },
            additional: [{ type: "early_bird", amount_cents: 4000 }],
          },
        }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
      expect(res.status).toBe(200);
    });
  });
});
