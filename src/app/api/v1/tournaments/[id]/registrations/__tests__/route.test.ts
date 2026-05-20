import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockTournamentBuilder,
  mockProfileBuilder,
  mockCapacityBuilder,
  mockExistingBuilder,
  mockInsertBuilder,
  mockFrom,
  mockGetUser,
  resetRegCallCount,
} = vi.hoisted(() => {
  function makeBuilder(finalResult: {
    data?: unknown;
    count?: unknown;
    error?: unknown;
  }) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "single", "maybeSingle", "insert"]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) => Promise.resolve(finalResult).then(onfulfilled, onrejected);
    return b;
  }

  const mockTournamentBuilder = makeBuilder({ data: null, error: null });
  const mockProfileBuilder = makeBuilder({ data: null, error: null });
  const mockCapacityBuilder = makeBuilder({ count: 0, error: null });
  const mockExistingBuilder = makeBuilder({ data: null, error: null });
  const mockInsertBuilder = makeBuilder({ data: null, error: null });

  let regCallCount = 0;
  const resetRegCallCount = () => {
    regCallCount = 0;
  };
  const mockFrom = vi.fn((table: string) => {
    if (table === "tournaments") return mockTournamentBuilder;
    if (table === "player_profiles") return mockProfileBuilder;
    if (table === "registrations") {
      const builders = [
        mockCapacityBuilder,
        mockExistingBuilder,
        mockInsertBuilder,
      ];
      return builders[regCallCount++] ?? mockInsertBuilder;
    }
    return makeBuilder({ data: null, error: null });
  });

  const mockGetUser = vi.fn();
  return {
    mockTournamentBuilder,
    mockProfileBuilder,
    mockCapacityBuilder,
    mockExistingBuilder,
    mockInsertBuilder,
    mockFrom,
    mockGetUser,
    resetRegCallCount,
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

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const FUTURE_DEADLINE = "2099-12-31T23:59:59Z";
const PAST_DEADLINE = "2020-01-01T00:00:00Z";

function makeTournament(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
    entry_fees: { standard: { amount_cents: 5000 }, additional: [] },
    max_participants: 100,
    registration_deadline: FUTURE_DEADLINE,
    restrictions: null,
    format: { type: "rapid", system: "swiss", rounds: 7 },
    ...overrides,
  };
}

function makeRegistration(status = "pending_payment") {
  return {
    id: "reg-uuid",
    user_id: USER_ID,
    tournament_id: VALID_UUID,
    fee_tier: "standard",
    status,
    registered_at: "2026-01-01T00:00:00Z",
    confirmed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
  };
}

function makeRequest(
  id: string,
  body: unknown = { fee_tier: "standard" },
): NextRequest {
  return new NextRequest(`http://localhost/api/v1/tournaments/${id}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Helpers to configure mock return values
// ---------------------------------------------------------------------------

function setTournamentResult(data: unknown, error: unknown = null) {
  (mockTournamentBuilder as Record<string, unknown>).then = (
    r: (v: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(r);
}

function setCapacityResult(count: number | null, error: unknown = null) {
  (mockCapacityBuilder as Record<string, unknown>).then = (
    r: (v: unknown) => unknown,
  ) => Promise.resolve({ count, error }).then(r);
}

function setProfileResult(data: unknown, error: unknown = null) {
  (mockProfileBuilder as Record<string, unknown>).then = (
    r: (v: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(r);
}

function setExistingResult(data: unknown, error: unknown = null) {
  (mockExistingBuilder as Record<string, unknown>).then = (
    r: (v: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(r);
}

function setInsertResult(data: unknown, error: unknown = null) {
  (mockInsertBuilder as Record<string, unknown>).then = (
    r: (v: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(r);
}

function setUser(id = USER_ID) {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
}

function setNoUser() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/tournaments/:id/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRegCallCount();
    setUser();
    setTournamentResult(makeTournament());
    setCapacityResult(0);
    setProfileResult(null);
    setExistingResult(null);
    setInsertResult(makeRegistration());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  describe("input validation", () => {
    it("returns 400 for a non-UUID tournament id", async () => {
      const res = await POST(makeRequest("not-a-uuid"), {
        params: Promise.resolve({ id: "not-a-uuid" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/invalid tournament id/i);
    });

    it("returns 401 when user is not authenticated", async () => {
      setNoUser();
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 400 when the request body is not valid JSON", async () => {
      const req = new NextRequest(
        `http://localhost/api/v1/tournaments/${VALID_UUID}/register`,
        { method: "POST", body: "not json" },
      );
      const res = await POST(req, {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when fee_tier is missing", async () => {
      const res = await POST(makeRequest(VALID_UUID, {}), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/fee_tier/i);
    });
  });

  // -------------------------------------------------------------------------
  // Tournament lookup
  // -------------------------------------------------------------------------

  describe("tournament lookup", () => {
    it("returns 404 when tournament is not found", async () => {
      setTournamentResult(null, { code: "PGRST116", message: "Not found" });
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 500 on a non-404 database error", async () => {
      setTournamentResult(null, { code: "500", message: "DB error" });
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Deadline check
  // -------------------------------------------------------------------------

  describe("deadline check", () => {
    it("returns 422 when registration deadline has passed", async () => {
      setTournamentResult(
        makeTournament({ registration_deadline: PAST_DEADLINE }),
      );
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("REGISTRATION_CLOSED");
    });
  });

  // -------------------------------------------------------------------------
  // Capacity check
  // -------------------------------------------------------------------------

  describe("capacity check", () => {
    it("returns 422 when tournament is already at capacity", async () => {
      setTournamentResult(makeTournament({ max_participants: 10 }));
      setCapacityResult(10);
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("CAPACITY_FULL");
    });

    it("allows registration when under capacity", async () => {
      setTournamentResult(makeTournament({ max_participants: 10 }));
      setCapacityResult(9);
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // Fee tier validation
  // -------------------------------------------------------------------------

  describe("fee tier validation", () => {
    it("returns 400 when fee_tier does not match any available tier", async () => {
      const res = await POST(
        makeRequest(VALID_UUID, { fee_tier: "nonexistent" }),
        { params: Promise.resolve({ id: VALID_UUID }) },
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_FEE_TIER");
    });

    it("returns 400 when the selected tier has expired", async () => {
      setTournamentResult(
        makeTournament({
          entry_fees: {
            standard: { amount_cents: 5000 },
            additional: [
              {
                type: "early_bird",
                amount_cents: 3500,
                valid_until: "2020-01-01T00:00:00Z",
              },
            ],
          },
        }),
      );
      const res = await POST(
        makeRequest(VALID_UUID, { fee_tier: "early_bird" }),
        { params: Promise.resolve({ id: VALID_UUID }) },
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_FEE_TIER");
      expect(json.error.message).toMatch(/expired/i);
    });
  });

  // -------------------------------------------------------------------------
  // Tournament-level restriction checks
  // -------------------------------------------------------------------------

  describe("tournament restrictions", () => {
    const baseProfile = {
      date_of_birth: null,
      gender: "male",
      is_oku: false,
      title: null,
      fide_rating: null,
      national_rating: null,
    };

    describe("title restriction", () => {
      it("returns 422 when tournament requires titled players and player has no title", async () => {
        setTournamentResult(
          makeTournament({ restrictions: { titles: ["GM", "IM"] } }),
        );
        setProfileResult({ ...baseProfile, title: null });
        const res = await POST(makeRequest(VALID_UUID), {
          params: Promise.resolve({ id: VALID_UUID }),
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.error.code).toBe("ELIGIBILITY_ERROR");
      });

      it("allows registration when player has a required title", async () => {
        setTournamentResult(
          makeTournament({ restrictions: { titles: ["GM", "IM"] } }),
        );
        setProfileResult({ ...baseProfile, title: "GM" });
        const res = await POST(makeRequest(VALID_UUID), {
          params: Promise.resolve({ id: VALID_UUID }),
        });
        expect(res.status).toBe(201);
      });
    });

    describe("rating restriction", () => {
      it("returns 422 when player rating is below the tournament minimum", async () => {
        setTournamentResult(
          makeTournament({ restrictions: { min_rating: 2000 } }),
        );
        setProfileResult({ ...baseProfile, fide_rating: { rapid: 1800 } });
        const res = await POST(makeRequest(VALID_UUID), {
          params: Promise.resolve({ id: VALID_UUID }),
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.error.code).toBe("ELIGIBILITY_ERROR");
        expect(json.error.message).toContain("2000");
      });

      it("returns 422 when player rating exceeds the tournament maximum", async () => {
        setTournamentResult(
          makeTournament({ restrictions: { max_rating: 1500 } }),
        );
        setProfileResult({ ...baseProfile, fide_rating: { rapid: 1800 } });
        const res = await POST(makeRequest(VALID_UUID), {
          params: Promise.resolve({ id: VALID_UUID }),
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.error.code).toBe("ELIGIBILITY_ERROR");
        expect(json.error.message).toContain("1500");
      });

      it("allows registration when player rating is within range", async () => {
        setTournamentResult(
          makeTournament({
            restrictions: { min_rating: 1000, max_rating: 2000 },
          }),
        );
        setProfileResult({ ...baseProfile, fide_rating: { rapid: 1500 } });
        const res = await POST(makeRequest(VALID_UUID), {
          params: Promise.resolve({ id: VALID_UUID }),
        });
        expect(res.status).toBe(201);
      });
    });

    describe("age restriction", () => {
      it("returns 422 when player has no DOB and tournament has an age restriction", async () => {
        setTournamentResult(makeTournament({ restrictions: { max_age: 18 } }));
        setProfileResult({ ...baseProfile, date_of_birth: null });
        const res = await POST(makeRequest(VALID_UUID), {
          params: Promise.resolve({ id: VALID_UUID }),
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.error.code).toBe("VALIDATION_ERROR");
      });

      it("returns 422 when player exceeds the tournament max_age", async () => {
        setTournamentResult(makeTournament({ restrictions: { max_age: 17 } }));
        // Born 2008-05-12 → age 18 at 2026-05-12
        setProfileResult({ ...baseProfile, date_of_birth: "2008-05-12" });
        const res = await POST(makeRequest(VALID_UUID), {
          params: Promise.resolve({ id: VALID_UUID }),
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.error.code).toBe("ELIGIBILITY_ERROR");
      });

      it("returns 422 when player is below the tournament min_age", async () => {
        setTournamentResult(makeTournament({ restrictions: { min_age: 19 } }));
        // Born 2008-05-12 → age 18 at 2026-05-12
        setProfileResult({ ...baseProfile, date_of_birth: "2008-05-12" });
        const res = await POST(makeRequest(VALID_UUID), {
          params: Promise.resolve({ id: VALID_UUID }),
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.error.code).toBe("ELIGIBILITY_ERROR");
      });
    });
  });

  // -------------------------------------------------------------------------
  // Fee-tier eligibility
  // -------------------------------------------------------------------------

  describe("fee-tier eligibility", () => {
    it("returns 400 when a female-only tier is selected by a male player", async () => {
      setTournamentResult(
        makeTournament({
          entry_fees: {
            standard: { amount_cents: 5000 },
            additional: [
              { type: "female", amount_cents: 3000, gender: "female" },
            ],
          },
        }),
      );
      setProfileResult({
        date_of_birth: null,
        gender: "male",
        is_oku: false,
        title: null,
        fide_rating: null,
        national_rating: null,
      });
      const res = await POST(makeRequest(VALID_UUID, { fee_tier: "female" }), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_FEE_TIER");
    });

    it("returns 400 when an OKU tier is selected by a non-OKU player", async () => {
      setTournamentResult(
        makeTournament({
          entry_fees: {
            standard: { amount_cents: 5000 },
            additional: [{ type: "oku", amount_cents: 2000, oku: true }],
          },
        }),
      );
      setProfileResult({
        date_of_birth: null,
        gender: "male",
        is_oku: false,
        title: null,
        fide_rating: null,
        national_rating: null,
      });
      const res = await POST(makeRequest(VALID_UUID, { fee_tier: "oku" }), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate registration
  // -------------------------------------------------------------------------

  describe("duplicate registration", () => {
    it("returns 200 with existing registration when status is confirmed", async () => {
      setExistingResult(makeRegistration("confirmed"));
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe("confirmed");
    });

    it("returns 200 with existing registration when status is pending_payment", async () => {
      setExistingResult(makeRegistration("pending_payment"));
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(200);
    });

    it("returns 409 when existing registration has a non-active status", async () => {
      setExistingResult(makeRegistration("cancelled_payment"));
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("ALREADY_REGISTERED");
    });
  });

  // -------------------------------------------------------------------------
  // Insert
  // -------------------------------------------------------------------------

  describe("insert", () => {
    it("returns 201 with registration data on success", async () => {
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.fee_tier).toBe("standard");
      expect(json.data.status).toBe("pending_payment");
    });

    it("returns 422 when insert fails due to tournament capacity trigger", async () => {
      setInsertResult(null, {
        code: "P0001",
        message: "Tournament is full (100 / 100 participants)",
      });
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("CAPACITY_FULL");
    });

    it("returns 500 on an unexpected insert error", async () => {
      setInsertResult(null, { code: "23505", message: "Unexpected DB error" });
      const res = await POST(makeRequest(VALID_UUID), {
        params: Promise.resolve({ id: VALID_UUID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });
});
