import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOrgBuilder,
  mockMembershipBuilder,
  mockTournamentFetchBuilder,
  mockTournamentUpdateBuilder,
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
  const mockTournamentFetchBuilder = makeBuilder({ data: null, error: null });
  const mockTournamentUpdateBuilder = makeBuilder({ data: null, error: null });

  // Track tournament table calls: first is fetch, second is update
  let tournamentCallIndex = 0;

  const mockFrom = vi.fn((table: string) => {
    if (table === "organizations") return mockOrgBuilder;
    if (table === "organization_memberships") return mockMembershipBuilder;
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

  (mockFrom as unknown as { _resetTournamentCallIndex: () => void })
    ._resetTournamentCallIndex = () => {
    tournamentCallIndex = 0;
  };

  const mockGetUser = vi.fn();

  return {
    mockOrgBuilder,
    mockMembershipBuilder,
    mockTournamentFetchBuilder,
    mockTournamentUpdateBuilder,
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

const EXISTING_TOURNAMENT = { id: TOUR_ID };

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
    `http://localhost/api/v1/organizer/${orgId}/tournaments/${id}`,
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
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
}

function setNoUser() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/v1/organizer/[orgId]/tournaments/[id]", () => {
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
        `http://localhost/api/v1/organizer/${ORG_ID}/tournaments/${TOUR_ID}`,
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
      setTournamentFetchResult(null, { code: "PGRST116", message: "Not found" });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 when tournament belongs to a different org", async () => {
      setUser();
      setTournamentFetchResult(null, { code: "PGRST116", message: "Not found" });
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
      const res = await PATCH(
        makeRequest(ORG_ID, TOUR_ID, { prizes: null }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }) },
      );
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

    it("works for a published tournament (post-publish edit)", async () => {
      setUser();
      setTournamentUpdateResult({ ...UPDATED_TOURNAMENT, status: "published" });
      const res = await PATCH(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe("published");
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
  });
});
