import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";


// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

// vi.mock is hoisted — use vi.hoisted() so these are available at hoist time.
const { mockTournamentsBuilder, mockRegistrationsBuilder, mockFrom } = vi.hoisted(() => {
  function makeBuilder(finalResult: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {};
    const methods = ["select", "eq", "neq", "in", "or", "gte", "lte", "lt", "gt", "filter", "order", "limit"];
    for (const m of methods) {
      chain[m] = vi.fn(() => chain);
    }
    chain.then = (onfulfilled: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
      Promise.resolve(finalResult).then(onfulfilled, onrejected);
    return chain;
  }
  const mockTournamentsBuilder = makeBuilder({ data: [], error: null });
  const mockRegistrationsBuilder = makeBuilder({ data: [], error: null });
  const mockFrom = vi.fn((table: string) => {
    if (table === "registrations") return mockRegistrationsBuilder;
    return mockTournamentsBuilder;
  });
  return { mockTournamentsBuilder, mockRegistrationsBuilder, mockFrom };
});

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

// ---------------------------------------------------------------------------
// Date constants — fixed "today" so date-range assertions are deterministic
//
//   MOCK_TODAY      2026-03-01
//   MOCK_WEEK_END   2026-03-08  (today + 7 days)
//   MOCK_MONTH_END  2026-04-01  (today + 1 month)
// ---------------------------------------------------------------------------

const MOCK_TODAY = "2026-03-01";
const MOCK_WEEK_END = "2026-03-08";
const MOCK_MONTH_END = "2026-04-01";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockOrganizer = {
  id: "org-1",
  organization_name: "KL Chess Association",
  links: [{ url: "https://klchess.org", label: "Website" }],
};

function makeTournament(overrides: Record<string, unknown> = {}) {
  return {
    id: "tournament-1",
    name: "KL Open Rapid 2026",
    venue_name: "Kuala Lumpur Convention Centre",
    venue_state: "Kuala Lumpur",
    start_date: "2026-03-15",
    end_date: "2026-03-16",
    registration_deadline: "2026-03-10T23:59:59Z",
    format: { type: "rapid", system: "swiss", rounds: 7 },
    is_fide_rated: true,
    is_mcf_rated: false,
    entry_fees: { standard: { amount_cents: 5000 }, additional: [] },
    max_participants: 120,
    poster_url: null,
    status: "published",
    organizer_profiles: mockOrganizer,
    ...overrides,
  };
}

/**
 * Six diverse tournaments for list-based filter tests.
 * (relative to MOCK_TODAY = 2026-03-01)
 *
 *  id      start        state         rating        format      window
 *  ------  -----------  ------------  ------------  ----------  ----------------------------
 *  t-wk-1  2026-03-03   Kuala Lumpur  FIDE          rapid       upcoming / this week / month
 *  t-wk-2  2026-03-07   Selangor      MCF           blitz       upcoming / this week / month
 *  t-mo-1  2026-03-15   Penang        FIDE          classical   upcoming / this month
 *  t-fu-1  2026-04-15   Kuala Lumpur  none          rapid       upcoming (beyond this month)
 *  t-pa-1  2026-02-10   Johor         MCF           rapid       past
 *  t-pa-2  2026-01-05   Kuala Lumpur  FIDE + MCF    blitz       past
 */
const T = {
  weekFideRapidKL: makeTournament({
    id: "t-wk-1",
    name: "KL Rapid Open",
    start_date: "2026-03-03",
    end_date: "2026-03-03",
    venue_state: "Kuala Lumpur",
    is_fide_rated: true,
    is_mcf_rated: false,
    format: { type: "rapid", system: "swiss", rounds: 7 },
  }),
  weekMcfBlitzSelangor: makeTournament({
    id: "t-wk-2",
    name: "Selangor Blitz Championship",
    start_date: "2026-03-07",
    end_date: "2026-03-07",
    venue_state: "Selangor",
    is_fide_rated: false,
    is_mcf_rated: true,
    format: { type: "blitz", system: "swiss", rounds: 9 },
  }),
  monthClassicalPenang: makeTournament({
    id: "t-mo-1",
    name: "Penang Chess Festival",
    start_date: "2026-03-15",
    end_date: "2026-03-17",
    venue_state: "Penang",
    is_fide_rated: true,
    is_mcf_rated: false,
    format: { type: "classical", system: "swiss", rounds: 9 },
  }),
  futureRapidKL: makeTournament({
    id: "t-fu-1",
    name: "KL April Rapid",
    start_date: "2026-04-15",
    end_date: "2026-04-16",
    venue_state: "Kuala Lumpur",
    is_fide_rated: false,
    is_mcf_rated: false,
    format: { type: "rapid", system: "swiss", rounds: 7 },
  }),
  pastMcfJohor: makeTournament({
    id: "t-pa-1",
    name: "Johor Open Rapid",
    start_date: "2026-02-10",
    end_date: "2026-02-20",
    venue_state: "Johor",
    is_fide_rated: false,
    is_mcf_rated: true,
    format: { type: "rapid", system: "swiss", rounds: 7 },
  }),
  pastFideMcfBlitzKL: makeTournament({
    id: "t-pa-2",
    name: "KL Blitz January",
    start_date: "2026-01-05",
    end_date: "2026-01-10",
    venue_state: "Kuala Lumpur",
    is_fide_rated: true,
    is_mcf_rated: true,
    format: { type: "blitz", system: "swiss", rounds: 9 },
  }),
};

const ALL_TOURNAMENTS = Object.values(T);
const UPCOMING      = [T.weekFideRapidKL, T.weekMcfBlitzSelangor, T.monthClassicalPenang, T.futureRapidKL];
const THIS_WEEK     = [T.weekFideRapidKL, T.weekMcfBlitzSelangor];
const THIS_MONTH    = [T.weekFideRapidKL, T.weekMcfBlitzSelangor, T.monthClassicalPenang];
const PAST          = [T.pastMcfJohor, T.pastFideMcfBlitzKL];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/tournaments");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

function setTournamentsResult(data: unknown, error: unknown = null) {
  const result = { data, error };
  (mockTournamentsBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
}

function setRegistrationsResult(data: unknown, error: unknown = null) {
  const result = { data, error };
  (mockRegistrationsBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/tournaments", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(MOCK_TODAY));
    vi.clearAllMocks();
    setTournamentsResult([]);
    setRegistrationsResult([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  describe("query parameter validation", () => {
    it("returns 400 for an invalid sort value", async () => {
      const res = await GET(makeRequest({ sort: "invalid" }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/invalid sort/i);
    });

    it("returns 400 for an invalid order value", async () => {
      const res = await GET(makeRequest({ order: "sideways" }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/invalid order/i);
    });

    it("returns 400 for an invalid date value", async () => {
      const res = await GET(makeRequest({ date: "yesterday" }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/invalid date/i);
    });

    it("returns 400 for a non-integer limit", async () => {
      const res = await GET(makeRequest({ limit: "abc" }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/invalid limit/i);
    });

    it("returns 400 for a limit less than 1", async () => {
      const res = await GET(makeRequest({ limit: "0" }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/invalid limit/i);
    });

    it("returns 400 for a malformed cursor", async () => {
      const res = await GET(makeRequest({ cursor: "not-valid-base64-json!" }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/invalid cursor/i);
    });
  });

  // -------------------------------------------------------------------------
  // Success — response shape
  // -------------------------------------------------------------------------

  describe("successful responses", () => {
    it("returns 200 with data, has_more:false, next_cursor:null when results fit in one page", async () => {
      setTournamentsResult([makeTournament()]);
      setRegistrationsResult([{ tournament_id: "tournament-1" }]);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toHaveProperty("data");
      expect(json).toHaveProperty("has_more", false);
      expect(json).toHaveProperty("next_cursor", null);
    });

    it("shapes each tournament item correctly", async () => {
      setTournamentsResult([makeTournament()]);
      setRegistrationsResult([]);

      const res = await GET(makeRequest());
      const json = await res.json();
      const item = json.data[0];

      expect(item.id).toBe("tournament-1");
      expect(item.name).toBe("KL Open Rapid 2026");
      expect(item.venue_name).toBe("Kuala Lumpur Convention Centre");
      expect(item.state).toBe("Kuala Lumpur");
      expect(item.start_date).toBe("2026-03-15");
      expect(item.end_date).toBe("2026-03-16");
      expect(item.format).toEqual({ type: "rapid", system: "swiss", rounds: 7 });
      expect(item.is_fide_rated).toBe(true);
      expect(item.is_mcf_rated).toBe(false);
      expect(item.max_participants).toBe(120);
      expect(item.poster_url).toBeNull();
      expect(item.status).toBe("published");
    });

    it("includes a nested organizer object with id, organization_name, links", async () => {
      setTournamentsResult([makeTournament()]);

      const res = await GET(makeRequest());
      const json = await res.json();
      const org = json.data[0].organizer;

      expect(org.id).toBe("org-1");
      expect(org.organization_name).toBe("KL Chess Association");
      expect(org.links).toEqual(mockOrganizer.links);
    });

    it("does not expose organizer_profiles or organizer_id on the tournament item", async () => {
      setTournamentsResult([makeTournament()]);

      const res = await GET(makeRequest());
      const json = await res.json();
      const item = json.data[0];

      expect(item).not.toHaveProperty("organizer_profiles");
      expect(item).not.toHaveProperty("organizer_id");
    });

    it("returns an empty data array when there are no published tournaments", async () => {
      setTournamentsResult([]);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toEqual([]);
      expect(json.has_more).toBe(false);
      expect(json.next_cursor).toBeNull();
    });

    it("returns all six tournaments in the list when no filters are applied", async () => {
      setTournamentsResult(ALL_TOURNAMENTS);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(6);
    });
  });

  // -------------------------------------------------------------------------
  // current_participants
  // -------------------------------------------------------------------------

  describe("current_participants", () => {
    it("counts confirmed registrations for each tournament", async () => {
      setTournamentsResult([makeTournament({ id: "t-1" }), makeTournament({ id: "t-2" })]);
      setRegistrationsResult([
        { tournament_id: "t-1" },
        { tournament_id: "t-1" },
        { tournament_id: "t-2" },
      ]);

      const res = await GET(makeRequest());
      const json = await res.json();

      const t1 = json.data.find((t: { id: string }) => t.id === "t-1");
      const t2 = json.data.find((t: { id: string }) => t.id === "t-2");
      expect(t1.current_participants).toBe(2);
      expect(t2.current_participants).toBe(1);
    });

    it("defaults current_participants to 0 when there are no confirmed registrations", async () => {
      setTournamentsResult([makeTournament()]);
      setRegistrationsResult([]);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(json.data[0].current_participants).toBe(0);
    });

    it("queries registrations filtered by status=confirmed", async () => {
      setTournamentsResult([makeTournament()]);
      setRegistrationsResult([]);

      await GET(makeRequest());

      const eqMock = mockRegistrationsBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("status", "confirmed");
    });

    it("correctly tallies participant counts across a list of tournaments", async () => {
      setTournamentsResult(ALL_TOURNAMENTS);
      setRegistrationsResult([
        { tournament_id: "t-wk-1" },
        { tournament_id: "t-wk-1" },
        { tournament_id: "t-wk-1" },
        { tournament_id: "t-wk-2" },
        { tournament_id: "t-mo-1" },
        { tournament_id: "t-mo-1" },
      ]);

      const res = await GET(makeRequest());
      const json = await res.json();

      const byId = Object.fromEntries(json.data.map((t: { id: string; current_participants: number }) => [t.id, t.current_participants]));
      expect(byId["t-wk-1"]).toBe(3);
      expect(byId["t-wk-2"]).toBe(1);
      expect(byId["t-mo-1"]).toBe(2);
      expect(byId["t-fu-1"]).toBe(0);
      expect(byId["t-pa-1"]).toBe(0);
      expect(byId["t-pa-2"]).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------

  describe("cursor-based pagination", () => {
    it("returns has_more:true and a next_cursor when results exceed the limit", async () => {
      // Return limit+1 rows (default limit is 20)
      const rows = Array.from({ length: 21 }, (_, i) =>
        makeTournament({ id: `t-${i}`, start_date: `2026-03-${String(i + 1).padStart(2, "0")}` })
      );
      setTournamentsResult(rows);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(json.has_more).toBe(true);
      expect(json.next_cursor).not.toBeNull();
      expect(json.data).toHaveLength(20);
    });

    it("next_cursor is a base64-encoded JSON with value and id fields", async () => {
      const rows = Array.from({ length: 21 }, (_, i) =>
        makeTournament({ id: `t-${i}`, start_date: `2026-03-${String(i + 1).padStart(2, "0")}` })
      );
      setTournamentsResult(rows);

      const res = await GET(makeRequest());
      const json = await res.json();

      const decoded = JSON.parse(Buffer.from(json.next_cursor, "base64").toString("utf-8"));
      expect(decoded).toHaveProperty("value");
      expect(decoded).toHaveProperty("id");
    });

    it("accepts a valid cursor without error", async () => {
      const cursor = Buffer.from(
        JSON.stringify({ value: "2026-03-15", id: "some-uuid" })
      ).toString("base64");
      setTournamentsResult([makeTournament()]);

      const res = await GET(makeRequest({ cursor }));
      expect(res.status).toBe(200);
    });

    it("respects a custom limit", async () => {
      const rows = Array.from({ length: 6 }, (_, i) =>
        makeTournament({ id: `t-${i}` })
      );
      setTournamentsResult(rows);

      const res = await GET(makeRequest({ limit: "5" }));
      const json = await res.json();

      expect(json.data).toHaveLength(5);
      expect(json.has_more).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Date filtering — uses mocked current date (MOCK_TODAY = 2026-03-01)
  // -------------------------------------------------------------------------

  describe("date filtering", () => {
    it("date=upcoming applies gte(start_date, today) and returns all upcoming tournaments", async () => {
      setTournamentsResult(UPCOMING);

      const res = await GET(makeRequest({ date: "upcoming" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(4);

      const gteMock = mockTournamentsBuilder.gte as ReturnType<typeof vi.fn>;
      expect(gteMock).toHaveBeenCalledWith("start_date", MOCK_TODAY);

      const ids = json.data.map((t: { id: string }) => t.id);
      expect(ids).toContain("t-wk-1");
      expect(ids).toContain("t-wk-2");
      expect(ids).toContain("t-mo-1");
      expect(ids).toContain("t-fu-1");
    });

    it("date=this_week applies gte+lte and returns only tournaments starting within 7 days", async () => {
      setTournamentsResult(THIS_WEEK);

      const res = await GET(makeRequest({ date: "this_week" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(2);

      const gteMock = mockTournamentsBuilder.gte as ReturnType<typeof vi.fn>;
      const lteMock = mockTournamentsBuilder.lte as ReturnType<typeof vi.fn>;
      expect(gteMock).toHaveBeenCalledWith("start_date", MOCK_TODAY);
      expect(lteMock).toHaveBeenCalledWith("start_date", MOCK_WEEK_END);

      const ids = json.data.map((t: { id: string }) => t.id);
      expect(ids).toContain("t-wk-1");
      expect(ids).toContain("t-wk-2");
      expect(ids).not.toContain("t-mo-1");
      expect(ids).not.toContain("t-fu-1");
    });

    it("date=this_month applies gte+lte and returns tournaments starting within this calendar month", async () => {
      setTournamentsResult(THIS_MONTH);

      const res = await GET(makeRequest({ date: "this_month" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(3);

      const gteMock = mockTournamentsBuilder.gte as ReturnType<typeof vi.fn>;
      const lteMock = mockTournamentsBuilder.lte as ReturnType<typeof vi.fn>;
      expect(gteMock).toHaveBeenCalledWith("start_date", MOCK_TODAY);
      expect(lteMock).toHaveBeenCalledWith("start_date", MOCK_MONTH_END);

      const ids = json.data.map((t: { id: string }) => t.id);
      expect(ids).toContain("t-wk-1");
      expect(ids).toContain("t-wk-2");
      expect(ids).toContain("t-mo-1");
      expect(ids).not.toContain("t-fu-1");
    });

    it("date=past applies lt(end_date, today) and returns only past tournaments", async () => {
      setTournamentsResult(PAST);

      const res = await GET(makeRequest({ date: "past" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(2);

      const ltMock = mockTournamentsBuilder.lt as ReturnType<typeof vi.fn>;
      expect(ltMock).toHaveBeenCalledWith("end_date", MOCK_TODAY);

      const ids = json.data.map((t: { id: string }) => t.id);
      expect(ids).toContain("t-pa-1");
      expect(ids).toContain("t-pa-2");
    });

    it("omitting date filter applies no date bounds and returns all tournaments", async () => {
      setTournamentsResult(ALL_TOURNAMENTS);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(6);

      const gteMock = mockTournamentsBuilder.gte as ReturnType<typeof vi.fn>;
      const lteMock = mockTournamentsBuilder.lte as ReturnType<typeof vi.fn>;
      const ltMock  = mockTournamentsBuilder.lt  as ReturnType<typeof vi.fn>;
      expect(gteMock).not.toHaveBeenCalled();
      expect(lteMock).not.toHaveBeenCalled();
      expect(ltMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Rating filtering
  // -------------------------------------------------------------------------

  describe("rating filtering", () => {
    it("rating=fide returns only FIDE-rated tournaments", async () => {
      const fideOnly = [T.weekFideRapidKL, T.monthClassicalPenang, T.pastFideMcfBlitzKL];
      setTournamentsResult(fideOnly);

      const res = await GET(makeRequest({ rating: "fide" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(3);

      const eqMock = mockTournamentsBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("is_fide_rated", true);

      expect(json.data.map((t: { id: string }) => t.id)).toEqual(
        expect.arrayContaining(["t-wk-1", "t-mo-1", "t-pa-2"])
      );
    });

    it("rating=mcf returns only MCF-rated tournaments", async () => {
      const mcfOnly = [T.weekMcfBlitzSelangor, T.pastMcfJohor, T.pastFideMcfBlitzKL];
      setTournamentsResult(mcfOnly);

      const res = await GET(makeRequest({ rating: "mcf" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(3);

      const eqMock = mockTournamentsBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("is_mcf_rated", true);

      expect(json.data.map((t: { id: string }) => t.id)).toEqual(
        expect.arrayContaining(["t-wk-2", "t-pa-1", "t-pa-2"])
      );
    });

    it("rating=fide,mcf applies an or() filter and returns all rated tournaments", async () => {
      const ratedAll = [T.weekFideRapidKL, T.weekMcfBlitzSelangor, T.monthClassicalPenang, T.pastMcfJohor, T.pastFideMcfBlitzKL];
      setTournamentsResult(ratedAll);

      const res = await GET(makeRequest({ rating: "fide,mcf" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(5);

      const orMock = mockTournamentsBuilder.or as ReturnType<typeof vi.fn>;
      expect(orMock).toHaveBeenCalledWith(
        expect.stringMatching(/is_fide_rated.*is_mcf_rated|is_mcf_rated.*is_fide_rated/)
      );

      // Unrated tournament is excluded
      const ids = json.data.map((t: { id: string }) => t.id);
      expect(ids).not.toContain("t-fu-1");
    });

    it("omitting rating filter returns tournaments regardless of rating", async () => {
      setTournamentsResult([T.futureRapidKL]);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data[0].id).toBe("t-fu-1");
      expect(json.data[0].is_fide_rated).toBe(false);
      expect(json.data[0].is_mcf_rated).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // State filtering
  // -------------------------------------------------------------------------

  describe("state filtering", () => {
    it("state=Kuala Lumpur returns only KL tournaments", async () => {
      const klOnly = [T.weekFideRapidKL, T.futureRapidKL, T.pastFideMcfBlitzKL];
      setTournamentsResult(klOnly);

      const res = await GET(makeRequest({ state: "Kuala Lumpur" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(3);

      const inMock = mockTournamentsBuilder.in as ReturnType<typeof vi.fn>;
      expect(inMock).toHaveBeenCalledWith("venue_state", ["Kuala Lumpur"]);

      expect(json.data.every((t: { state: string }) => t.state === "Kuala Lumpur")).toBe(true);
    });

    it("state=Selangor,Penang returns tournaments from both states", async () => {
      const multiState = [T.weekMcfBlitzSelangor, T.monthClassicalPenang];
      setTournamentsResult(multiState);

      const res = await GET(makeRequest({ state: "Selangor,Penang" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(2);

      const inMock = mockTournamentsBuilder.in as ReturnType<typeof vi.fn>;
      expect(inMock).toHaveBeenCalledWith("venue_state", ["Selangor", "Penang"]);

      const states = json.data.map((t: { state: string }) => t.state);
      expect(states).toContain("Selangor");
      expect(states).toContain("Penang");
    });
  });

  // -------------------------------------------------------------------------
  // Format filtering
  // -------------------------------------------------------------------------

  describe("format filtering", () => {
    it("format=rapid uses a filter() call and returns only rapid tournaments", async () => {
      const rapidOnly = [T.weekFideRapidKL, T.futureRapidKL, T.pastMcfJohor];
      setTournamentsResult(rapidOnly);

      const res = await GET(makeRequest({ format: "rapid" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(3);

      const filterMock = mockTournamentsBuilder.filter as ReturnType<typeof vi.fn>;
      expect(filterMock).toHaveBeenCalledWith("format->>type", "eq", "rapid");

      expect(
        json.data.every((t: { format: { type: string } }) => t.format.type === "rapid")
      ).toBe(true);
    });

    it("format=blitz,classical applies an or() filter and returns those formats", async () => {
      const blitzOrClassical = [T.weekMcfBlitzSelangor, T.monthClassicalPenang, T.pastFideMcfBlitzKL];
      setTournamentsResult(blitzOrClassical);

      const res = await GET(makeRequest({ format: "blitz,classical" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(3);

      const orMock = mockTournamentsBuilder.or as ReturnType<typeof vi.fn>;
      expect(orMock).toHaveBeenCalledWith(expect.stringMatching(/blitz.*classical|classical.*blitz/i));

      const formats = json.data.map((t: { format: { type: string } }) => t.format.type);
      expect(formats).not.toContain("rapid");
    });
  });

  // -------------------------------------------------------------------------
  // Search filtering
  // -------------------------------------------------------------------------

  describe("search filtering", () => {
    it("applies a search filter via or() for name and venue_name", async () => {
      setTournamentsResult([T.weekFideRapidKL]);

      await GET(makeRequest({ search: "KL Rapid" }));

      const orMock = mockTournamentsBuilder.or as ReturnType<typeof vi.fn>;
      expect(orMock).toHaveBeenCalledWith(expect.stringMatching(/name.*ilike.*KL Rapid/i));
    });
  });

  // -------------------------------------------------------------------------
  // Combined filters — verify multiple filters are applied together
  // -------------------------------------------------------------------------

  describe("combined filters", () => {
    it("date=upcoming + rating=fide returns upcoming FIDE-rated tournaments", async () => {
      const upcomingFide = [T.weekFideRapidKL, T.monthClassicalPenang];
      setTournamentsResult(upcomingFide);

      const res = await GET(makeRequest({ date: "upcoming", rating: "fide" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(2);

      const gteMock = mockTournamentsBuilder.gte as ReturnType<typeof vi.fn>;
      const eqMock  = mockTournamentsBuilder.eq  as ReturnType<typeof vi.fn>;
      expect(gteMock).toHaveBeenCalledWith("start_date", MOCK_TODAY);
      expect(eqMock).toHaveBeenCalledWith("is_fide_rated", true);

      const ids = json.data.map((t: { id: string }) => t.id);
      expect(ids).toContain("t-wk-1");
      expect(ids).toContain("t-mo-1");
    });

    it("date=this_week + state=Selangor returns only this week's Selangor tournaments", async () => {
      setTournamentsResult([T.weekMcfBlitzSelangor]);

      const res = await GET(makeRequest({ date: "this_week", state: "Selangor" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(1);

      const gteMock  = mockTournamentsBuilder.gte as ReturnType<typeof vi.fn>;
      const lteMock  = mockTournamentsBuilder.lte as ReturnType<typeof vi.fn>;
      const inMock   = mockTournamentsBuilder.in  as ReturnType<typeof vi.fn>;
      expect(gteMock).toHaveBeenCalledWith("start_date", MOCK_TODAY);
      expect(lteMock).toHaveBeenCalledWith("start_date", MOCK_WEEK_END);
      expect(inMock).toHaveBeenCalledWith("venue_state", ["Selangor"]);

      expect(json.data[0].id).toBe("t-wk-2");
      expect(json.data[0].state).toBe("Selangor");
    });

    it("date=this_month + format=classical returns classical tournaments this month", async () => {
      setTournamentsResult([T.monthClassicalPenang]);

      const res = await GET(makeRequest({ date: "this_month", format: "classical" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(1);

      const gteMock    = mockTournamentsBuilder.gte    as ReturnType<typeof vi.fn>;
      const lteMock    = mockTournamentsBuilder.lte    as ReturnType<typeof vi.fn>;
      const filterMock = mockTournamentsBuilder.filter as ReturnType<typeof vi.fn>;
      expect(gteMock).toHaveBeenCalledWith("start_date", MOCK_TODAY);
      expect(lteMock).toHaveBeenCalledWith("start_date", MOCK_MONTH_END);
      expect(filterMock).toHaveBeenCalledWith("format->>type", "eq", "classical");

      expect(json.data[0].id).toBe("t-mo-1");
      expect(json.data[0].format).toEqual({ type: "classical", system: "swiss", rounds: 9 });
    });

    it("date=upcoming + rating=mcf + state=Selangor returns upcoming MCF Selangor tournaments", async () => {
      setTournamentsResult([T.weekMcfBlitzSelangor]);

      const res = await GET(makeRequest({ date: "upcoming", rating: "mcf", state: "Selangor" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(1);

      const gteMock = mockTournamentsBuilder.gte as ReturnType<typeof vi.fn>;
      const eqMock  = mockTournamentsBuilder.eq  as ReturnType<typeof vi.fn>;
      const inMock  = mockTournamentsBuilder.in  as ReturnType<typeof vi.fn>;
      expect(gteMock).toHaveBeenCalledWith("start_date", MOCK_TODAY);
      expect(eqMock).toHaveBeenCalledWith("is_mcf_rated", true);
      expect(inMock).toHaveBeenCalledWith("venue_state", ["Selangor"]);

      expect(json.data[0].state).toBe("Selangor");
      expect(json.data[0].is_mcf_rated).toBe(true);
    });

    it("date=past + rating=fide,mcf returns past rated tournaments", async () => {
      setTournamentsResult(PAST);

      const res = await GET(makeRequest({ date: "past", rating: "fide,mcf" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(2);

      const ltMock = mockTournamentsBuilder.lt as ReturnType<typeof vi.fn>;
      const orMock = mockTournamentsBuilder.or as ReturnType<typeof vi.fn>;
      expect(ltMock).toHaveBeenCalledWith("end_date", MOCK_TODAY);
      expect(orMock).toHaveBeenCalledWith(
        expect.stringMatching(/is_fide_rated.*is_mcf_rated|is_mcf_rated.*is_fide_rated/)
      );

      const ids = json.data.map((t: { id: string }) => t.id);
      expect(ids).toContain("t-pa-1");
      expect(ids).toContain("t-pa-2");
    });

    it("search + state + date=this_week applies all three filters", async () => {
      setTournamentsResult([T.weekFideRapidKL]);

      const res = await GET(makeRequest({ search: "KL Rapid", state: "Kuala Lumpur", date: "this_week" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(1);

      const orMock  = mockTournamentsBuilder.or  as ReturnType<typeof vi.fn>;
      const inMock  = mockTournamentsBuilder.in  as ReturnType<typeof vi.fn>;
      const gteMock = mockTournamentsBuilder.gte as ReturnType<typeof vi.fn>;
      const lteMock = mockTournamentsBuilder.lte as ReturnType<typeof vi.fn>;
      expect(orMock).toHaveBeenCalledWith(expect.stringMatching(/name.*ilike.*KL Rapid/i));
      expect(inMock).toHaveBeenCalledWith("venue_state", ["Kuala Lumpur"]);
      expect(gteMock).toHaveBeenCalledWith("start_date", MOCK_TODAY);
      expect(lteMock).toHaveBeenCalledWith("start_date", MOCK_WEEK_END);
    });

    it("date=upcoming + format=rapid + state=Kuala Lumpur returns upcoming rapid KL tournaments", async () => {
      setTournamentsResult([T.weekFideRapidKL, T.futureRapidKL]);

      const res = await GET(makeRequest({ date: "upcoming", format: "rapid", state: "Kuala Lumpur" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(2);

      const gteMock    = mockTournamentsBuilder.gte    as ReturnType<typeof vi.fn>;
      const filterMock = mockTournamentsBuilder.filter as ReturnType<typeof vi.fn>;
      const inMock     = mockTournamentsBuilder.in     as ReturnType<typeof vi.fn>;
      expect(gteMock).toHaveBeenCalledWith("start_date", MOCK_TODAY);
      expect(filterMock).toHaveBeenCalledWith("format->>type", "eq", "rapid");
      expect(inMock).toHaveBeenCalledWith("venue_state", ["Kuala Lumpur"]);

      expect(
        json.data.every((t: { state: string; format: { type: string } }) =>
          t.state === "Kuala Lumpur" && t.format.type === "rapid"
        )
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  describe("sorting", () => {
    it.each([["start_date"], ["created_at"], ["name"]])(
      "accepts sort=%s without error",
      async (sort) => {
        setTournamentsResult([]);

        const res = await GET(makeRequest({ sort }));
        expect(res.status).toBe(200);

        const orderMock = mockTournamentsBuilder.order as ReturnType<typeof vi.fn>;
        expect(orderMock).toHaveBeenCalledWith(sort, expect.objectContaining({ ascending: true }));
      }
    );

    it("applies descending order when order=desc", async () => {
      setTournamentsResult([]);

      await GET(makeRequest({ order: "desc" }));

      const orderMock = mockTournamentsBuilder.order as ReturnType<typeof vi.fn>;
      expect(orderMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ ascending: false })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("returns 500 when Supabase returns an error on the tournaments query", async () => {
      setTournamentsResult(null, { message: "DB connection failed" });

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("DB connection failed");
    });
  });
});
