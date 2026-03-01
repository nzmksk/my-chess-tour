import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

const { mockTournamentsBuilder, mockRegistrationsBuilder, mockFrom } = vi.hoisted(() => {
  function makeBuilder(finalResult: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {};
    const methods = ["select", "eq", "in", "order"];
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
    time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 0 },
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

describe("GET /api/v1/tournaments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTournamentsResult([]);
    setRegistrationsResult([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe("response shape", () => {
    it("returns 200 with a data array", async () => {
      setTournamentsResult([makeTournament()]);

      const res = await GET();
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toHaveProperty("data");
      expect(Array.isArray(json.data)).toBe(true);
    });

    it("shapes each tournament item correctly", async () => {
      setTournamentsResult([makeTournament()]);

      const res = await GET();
      const json = await res.json();
      const item = json.data[0];

      expect(item.id).toBe("tournament-1");
      expect(item.name).toBe("KL Open Rapid 2026");
      expect(item.venue_name).toBe("Kuala Lumpur Convention Centre");
      expect(item.state).toBe("Kuala Lumpur");
      expect(item.start_date).toBe("2026-03-15");
      expect(item.end_date).toBe("2026-03-16");
      expect(item.registration_deadline).toBe("2026-03-10T23:59:59Z");
      expect(item.format).toEqual({ type: "rapid", system: "swiss", rounds: 7 });
      expect(item.time_control).toEqual({ base_minutes: 15, increment_seconds: 10, delay_seconds: 0 });
      expect(item.is_fide_rated).toBe(true);
      expect(item.is_mcf_rated).toBe(false);
      expect(item.max_participants).toBe(120);
      expect(item.poster_url).toBeNull();
      expect(item.status).toBe("published");
    });

    it("includes a nested organizer object with id, organization_name, links", async () => {
      setTournamentsResult([makeTournament()]);

      const res = await GET();
      const json = await res.json();
      const org = json.data[0].organizer;

      expect(org.id).toBe("org-1");
      expect(org.organization_name).toBe("KL Chess Association");
      expect(org.links).toEqual(mockOrganizer.links);
    });

    it("does not expose organizer_profiles or organizer_id on the tournament item", async () => {
      setTournamentsResult([makeTournament()]);

      const res = await GET();
      const json = await res.json();

      expect(json.data[0]).not.toHaveProperty("organizer_profiles");
      expect(json.data[0]).not.toHaveProperty("organizer_id");
    });

    it("returns an empty data array when there are no matching tournaments", async () => {
      setTournamentsResult([]);

      const res = await GET();
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toEqual([]);
    });

    it("sets organizer to null when organizer_profiles is null", async () => {
      setTournamentsResult([makeTournament({ organizer_profiles: null })]);

      const res = await GET();
      const json = await res.json();

      expect(json.data[0].organizer).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Query behaviour
  // -------------------------------------------------------------------------

  describe("query behaviour", () => {
    it("queries only published tournaments", async () => {
      setTournamentsResult([]);

      await GET();

      const eqMock = mockTournamentsBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("status", "published");
    });

    it("orders results by start_date ascending", async () => {
      setTournamentsResult([]);

      await GET();

      const orderMock = mockTournamentsBuilder.order as ReturnType<typeof vi.fn>;
      expect(orderMock).toHaveBeenCalledWith("start_date", { ascending: true });
    });
  });

  // -------------------------------------------------------------------------
  // current_participants
  // -------------------------------------------------------------------------

  describe("current_participants", () => {
    it("counts confirmed registrations per tournament", async () => {
      setTournamentsResult([makeTournament({ id: "t-1" }), makeTournament({ id: "t-2" })]);
      setRegistrationsResult([
        { tournament_id: "t-1" },
        { tournament_id: "t-1" },
        { tournament_id: "t-2" },
      ]);

      const res = await GET();
      const json = await res.json();

      const t1 = json.data.find((t: { id: string }) => t.id === "t-1");
      const t2 = json.data.find((t: { id: string }) => t.id === "t-2");
      expect(t1.current_participants).toBe(2);
      expect(t2.current_participants).toBe(1);
    });

    it("defaults current_participants to 0 when there are no confirmed registrations", async () => {
      setTournamentsResult([makeTournament()]);
      setRegistrationsResult([]);

      const res = await GET();
      const json = await res.json();

      expect(json.data[0].current_participants).toBe(0);
    });

    it("queries registrations filtered by status=confirmed", async () => {
      setTournamentsResult([makeTournament()]);
      setRegistrationsResult([]);

      await GET();

      const eqMock = mockRegistrationsBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("status", "confirmed");
    });

    it("skips the registrations query when there are no tournaments", async () => {
      setTournamentsResult([]);

      await GET();

      expect(mockFrom).not.toHaveBeenCalledWith("registrations");
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("returns 500 when Supabase returns an error", async () => {
      setTournamentsResult(null, { message: "DB connection failed" });

      const res = await GET();
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("DB connection failed");
    });
  });
});
