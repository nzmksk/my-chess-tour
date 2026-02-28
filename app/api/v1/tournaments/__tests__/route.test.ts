import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    vi.clearAllMocks();
    setTournamentsResult([]);
    setRegistrationsResult([]);
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
  // Filters — verify the query builder receives filter calls
  // -------------------------------------------------------------------------

  describe("filter application", () => {
    it("applies a search filter via or() for name and venue_name", async () => {
      setTournamentsResult([]);

      await GET(makeRequest({ search: "open" }));

      const orMock = mockTournamentsBuilder.or as ReturnType<typeof vi.fn>;
      expect(orMock).toHaveBeenCalledWith(expect.stringMatching(/name.*ilike.*open/i));
    });

    it("applies a state filter via in()", async () => {
      setTournamentsResult([]);

      await GET(makeRequest({ state: "selangor,penang" }));

      const inMock = mockTournamentsBuilder.in as ReturnType<typeof vi.fn>;
      expect(inMock).toHaveBeenCalledWith("venue_state", ["selangor", "penang"]);
    });

    it("applies a format filter via or()", async () => {
      setTournamentsResult([]);

      await GET(makeRequest({ format: "rapid,blitz" }));

      const orMock = mockTournamentsBuilder.or as ReturnType<typeof vi.fn>;
      expect(orMock).toHaveBeenCalledWith(expect.stringMatching(/rapid.*blitz|blitz.*rapid/i));
    });

    it("applies a fide rating filter via eq()", async () => {
      setTournamentsResult([]);

      await GET(makeRequest({ rating: "fide" }));

      const eqMock = mockTournamentsBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("is_fide_rated", true);
    });

    it("applies a mcf rating filter via eq()", async () => {
      setTournamentsResult([]);

      await GET(makeRequest({ rating: "mcf" }));

      const eqMock = mockTournamentsBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("is_mcf_rated", true);
    });

    it("applies a combined fide+mcf rating filter via or()", async () => {
      setTournamentsResult([]);

      await GET(makeRequest({ rating: "fide,mcf" }));

      const orMock = mockTournamentsBuilder.or as ReturnType<typeof vi.fn>;
      expect(orMock).toHaveBeenCalledWith(
        expect.stringMatching(/is_fide_rated.*is_mcf_rated|is_mcf_rated.*is_fide_rated/)
      );
    });

    it("applies an upcoming date filter via gte()", async () => {
      setTournamentsResult([]);

      await GET(makeRequest({ date: "upcoming" }));

      const gteMock = mockTournamentsBuilder.gte as ReturnType<typeof vi.fn>;
      expect(gteMock).toHaveBeenCalledWith("start_date", expect.any(String));
    });

    it("applies a past date filter via lt()", async () => {
      setTournamentsResult([]);

      await GET(makeRequest({ date: "past" }));

      const ltMock = mockTournamentsBuilder.lt as ReturnType<typeof vi.fn>;
      expect(ltMock).toHaveBeenCalledWith("end_date", expect.any(String));
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
