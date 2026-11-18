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
  mockContactsBuilder,
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
      "neq",
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
  const mockContactsBuilder = makeBuilder({ data: [], error: null });

  // Track tournament table calls: first is fetch, second is update
  let tournamentCallIndex = 0;

  const mockFrom = vi.fn((table: string) => {
    if (table === "organizations") return mockOrgBuilder;
    if (table === "organization_memberships") return mockMembershipBuilder;
    if (table === "prize_funder_contacts") return mockContactsBuilder;
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

  // Expose a reset for the call index
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
    mockContactsBuilder,
    mockFrom,
    mockGetClaims,
  };
});

const { mockSync } = vi.hoisted(() => ({ mockSync: vi.fn() }));
vi.mock("@/services/prizes/funding-requests", () => ({
  syncPrizeFundingRequests: mockSync,
}));

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

import { POST } from "../route";
import { revalidateTag } from "next/cache";
import { appIdFor } from "@/test/identity";

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

// Uses a far-future date that won't become "past" during tests
const VALID_DRAFT_TOURNAMENT = {
  id: TOUR_ID,
  organization_id: ORG_ID,
  name: "KL Open Rapid 2026",
  venue_name: "KLCC",
  venue_state: "Kuala Lumpur",
  venue_address: "Jalan Pinang, 50088 KL",
  start_date: "2099-01-15",
  end_date: "2099-01-16",
  registration_deadline: "2099-01-10T23:59:59Z",
  format: { type: "rapid", system: "swiss", rounds: 7 },
  time_control: { base_minutes: 10, increment_seconds: 5, delay_seconds: 0 },
  entry_fees: { standard: { amount_cents: 5000 }, additional: [] },
  status: "draft",
};

const PUBLISHED_RESULT = {
  id: TOUR_ID,
  status: "published",
  published_at: "2026-05-26T12:00:00Z",
};

function makeRequest(
  orgId: string = ORG_ID,
  id: string = TOUR_ID,
): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/tournaments/${id}/publish`,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetTournamentCalls() {
  (
    mockFrom as unknown as { _resetTournamentCallIndex: () => void }
  )._resetTournamentCallIndex();
}

function setUser(userId = USER_ID) {
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: userId } },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetTournamentCalls();
  setOrgResult(APPROVED_ORG);
  setMembershipResult({ roles: { name: "owner" } });
  setTournamentFetchResult(VALID_DRAFT_TOURNAMENT);
  setTournamentUpdateResult(PUBLISHED_RESULT);
});

afterEach(() => {
  vi.clearAllMocks();
  resetTournamentCalls();
});

describe("POST /api/v1/organizations/[orgId]/tournaments/[id]/publish", () => {
  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      setNoUser();
      const res = await POST(makeRequest(), {
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
      const res = await POST(makeRequest("not-a-uuid"), {
        params: Promise.resolve({ orgId: "not-a-uuid", id: TOUR_ID }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid tournament ID format", async () => {
      setUser();
      const res = await POST(makeRequest(ORG_ID, "not-a-uuid"), {
        params: Promise.resolve({ orgId: ORG_ID, id: "not-a-uuid" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("organization checks", () => {
    it("returns 404 when organization does not exist", async () => {
      setUser();
      setOrgResult(null, { code: "PGRST116", message: "Not found" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 403 when organization is not approved", async () => {
      setUser();
      setOrgResult({ ...APPROVED_ORG, approval_status: "pending" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("permission checks", () => {
    it("allows the org creator to publish", async () => {
      setUser(USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
    });

    it("allows an org admin member to publish", async () => {
      setUser(MEMBER_USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      setMembershipResult({ roles: { name: "admin" } });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
    });

    it("returns 403 for a member-role user", async () => {
      setUser(MEMBER_USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      setMembershipResult({ roles: { name: "member" } });
      const res = await POST(makeRequest(), {
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
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("tournament state checks", () => {
    it("returns 404 when tournament does not exist", async () => {
      setUser();
      setTournamentFetchResult(null, {
        code: "PGRST116",
        message: "Not found",
      });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 409 when tournament is already published", async () => {
      setUser();
      setTournamentFetchResult({
        ...VALID_DRAFT_TOURNAMENT,
        status: "published",
      });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
    });

    it("returns 409 when tournament is cancelled", async () => {
      setUser();
      setTournamentFetchResult({
        ...VALID_DRAFT_TOURNAMENT,
        status: "cancelled",
      });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
    });
  });

  describe("publish validation", () => {
    it("returns 422 when venue_name is empty", async () => {
      setUser();
      setTournamentFetchResult({ ...VALID_DRAFT_TOURNAMENT, venue_name: "" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    // Special prizes attach to a placed result, so they cannot stand alone.
    it("returns 422 when special prizes are the only prizes declared", async () => {
      setUser();
      setTournamentFetchResult({
        ...VALID_DRAFT_TOURNAMENT,
        prizes: {
          categories: [],
          special: [
            {
              name: "Best Female Player",
              funding: { source: "sponsor", funder_name: "ACME Sdn Bhd" },
              amount_cents: 20000,
            },
          ],
        },
      });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details).toContain(
        "Add at least one prize category with a placing — special prizes cannot be the only prizes a tournament awards",
      );
    });

    it("publishes when special prizes sit alongside a filled category", async () => {
      setUser();
      const funding = { source: "sponsor", funder_name: "ACME Sdn Bhd" };
      setTournamentFetchResult({
        ...VALID_DRAFT_TOURNAMENT,
        prizes: {
          categories: [
            { name: "Open", funding, entries: [{ amount_cents: 50000 }] },
          ],
          special: [
            { name: "Best Female Player", funding, amount_cents: 20000 },
          ],
        },
      });
      setTournamentUpdateResult(PUBLISHED_RESULT);
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
    });

    it("returns 422 when start_date is the placeholder date", async () => {
      setUser();
      setTournamentFetchResult({
        ...VALID_DRAFT_TOURNAMENT,
        start_date: "2099-12-31",
        end_date: "2099-12-31",
        // exact placeholder deadline value triggers validation error
        registration_deadline: "2099-12-30T23:59:59Z",
      });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 when format type is empty", async () => {
      setUser();
      setTournamentFetchResult({
        ...VALID_DRAFT_TOURNAMENT,
        format: { type: "", system: "swiss", rounds: 7 },
      });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 when time control base_minutes is 0", async () => {
      setUser();
      setTournamentFetchResult({
        ...VALID_DRAFT_TOURNAMENT,
        time_control: { base_minutes: 0 },
      });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 when entry_fees has no standard fee", async () => {
      setUser();
      setTournamentFetchResult({
        ...VALID_DRAFT_TOURNAMENT,
        entry_fees: { additional: [] },
      });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 with details array listing all validation errors", async () => {
      setUser();
      setTournamentFetchResult({
        ...VALID_DRAFT_TOURNAMENT,
        venue_name: "",
        venue_state: "",
        format: { type: "", system: "", rounds: 0 },
      });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(Array.isArray(body.error.details)).toBe(true);
      expect(body.error.details.length).toBeGreaterThan(1);
    });
  });

  describe("successful publish", () => {
    it("returns 200 with published tournament data", async () => {
      setUser();
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(TOUR_ID);
      expect(body.data.status).toBe("published");
      expect(body.data.published_at).toBeDefined();
    });

    it("defaults registration_closed_at to the deadline on publish", async () => {
      setUser();
      await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(mockTournamentUpdateBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "published",
          registration_closed_at: VALID_DRAFT_TOURNAMENT.registration_deadline,
        }),
      );
    });
  });

  describe("platform-distributed prizes", () => {
    const PLATFORM_DRAFT = {
      ...VALID_DRAFT_TOURNAMENT,
      prizes: {
        categories: [
          {
            name: "Open",
            funding: { source: "sponsor", funder_name: "ACME" },
            entries: [{ place: "1st", amount_cents: 30000 }],
          },
        ],
        distribution: "platform",
      },
    };

    function setContacts(data: unknown, error: unknown = null) {
      (mockContactsBuilder as Record<string, unknown>).then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
    }

    beforeEach(() => {
      setTournamentFetchResult(PLATFORM_DRAFT);
      setTournamentUpdateResult({ ...PUBLISHED_RESULT, status: "pending_funding" });
      setContacts([{ funder_name: "ACME", funder_email: "pay@acme.test" }]);
      mockSync.mockResolvedValue({
        error: null,
        released: false,
        linked: 1,
        unlinked: 0,
        missingContacts: [],
      });
    });

    it("refuses to publish without every funder's address", async () => {
      setUser();
      setContacts([]);
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.message).toBe(
        "ACME: add the email address their payment link is sent to",
      );
      expect(mockTournamentUpdateBuilder.update).not.toHaveBeenCalled();
      expect(mockSync).not.toHaveBeenCalled();
    });

    it("publishes into pending_funding, unlisted, and sends the payment links", async () => {
      setUser();
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      expect(mockTournamentUpdateBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "pending_funding" }),
      );
      expect(mockSync).toHaveBeenCalledWith(TOUR_ID, appIdFor(USER_ID));
      const body = await res.json();
      expect(body.data.status).toBe("pending_funding");
      expect(body.data.funding).toEqual({ linked: 1, unlinked: 0, missing_contacts: [] });
      // Nothing public changed.
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it("still publishes when CHIP is down, leaving the links to be retried", async () => {
      setUser();
      mockSync.mockResolvedValue({
        error: null,
        released: false,
        linked: 0,
        unlinked: 1,
        missingContacts: [],
      });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).data.funding.unlinked).toBe(1);
    });

    it("lists straight away when the organizer pays the winners", async () => {
      setUser();
      setTournamentFetchResult({
        ...PLATFORM_DRAFT,
        prizes: { ...PLATFORM_DRAFT.prizes, distribution: "organizer" },
      });
      setTournamentUpdateResult(PUBLISHED_RESULT);
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(200);
      expect(mockTournamentUpdateBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "published" }),
      );
      expect(mockContactsBuilder.select).not.toHaveBeenCalled();
      expect(mockSync).not.toHaveBeenCalled();
      expect(revalidateTag).toHaveBeenCalled();
    });
  });

  describe("database errors", () => {
    it("returns 500 when the update fails", async () => {
      setUser();
      setTournamentUpdateResult(null, { message: "DB update failed" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });
  });
});
