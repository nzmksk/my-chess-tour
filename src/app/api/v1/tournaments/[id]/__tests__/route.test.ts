import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

const { mockTournamentBuilder, mockRegistrationsBuilder, mockFrom } =
  vi.hoisted(() => {
    function makeBuilder(finalResult: { data?: unknown; count?: unknown; error: unknown }) {
      const chain: Record<string, unknown> = {};
      const methods = ["select", "eq", "single", "in"];
      for (const m of methods) {
        chain[m] = vi.fn(() => chain);
      }
      chain.then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) => Promise.resolve(finalResult).then(onfulfilled, onrejected);
      return chain;
    }
    const mockTournamentBuilder = makeBuilder({ data: null, error: null });
    const mockRegistrationsBuilder = makeBuilder({ count: 0, error: null });
    const mockFrom = vi.fn((table: string) => {
      if (table === "registrations") return mockRegistrationsBuilder;
      return mockTournamentBuilder;
    });
    return { mockTournamentBuilder, mockRegistrationsBuilder, mockFrom };
  });

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockOrganization = {
  id: "org-1",
  name: "KL Chess Association",
  description: "Premier chess org in KL",
  avatar_url: null,
  links: [{ url: "https://klchess.org", label: "Website" }],
  email: "info@klchess.org",
  phone: "+60123456789",
};

function makeTournament(overrides: Record<string, unknown> = {}) {
  return {
    id: "tournament-1",
    name: "KL Open Rapid 2026",
    description: "Annual rapid chess championship",
    venue_name: "Kuala Lumpur Convention Centre",
    venue_state: "Kuala Lumpur",
    venue_address: "Jalan Pinang, 50450 Kuala Lumpur",
    start_date: "2026-03-15",
    end_date: "2026-03-16",
    registration_deadline: "2026-03-10T23:59:59Z",
    format: { type: "rapid", system: "swiss", rounds: 7 },
    time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 0 },
    is_fide_rated: true,
    is_mcf_rated: false,
    entry_fees: { standard: { amount_cents: 5000 }, additional: [] },
    prizes: { first: 2000, second: 1000, third: 500 },
    restrictions: {
      min_rating: null,
      max_rating: 2200,
      min_age: null,
      max_age: null,
    },
    max_participants: 120,
    status: "published",
    published_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T12:00:00Z",
    organizations: mockOrganization,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/tournaments/${id}`);
}

function setTournamentResult(data: unknown, error: unknown = null) {
  const result = { data, error };
  (mockTournamentBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
}

function setRegistrationsCount(count: number | null, error: unknown = null) {
  const result = { count, error };
  (mockRegistrationsBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/tournaments/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTournamentResult(null);
    setRegistrationsCount(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe("response shape", () => {
    it("returns 200 with a data object for a valid published tournament", async () => {
      setTournamentResult(makeTournament());

      const res = await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toHaveProperty("data");
      expect(typeof json.data).toBe("object");
      expect(Array.isArray(json.data)).toBe(false);
    });

    it("shapes the tournament detail correctly", async () => {
      setTournamentResult(makeTournament());

      const res = await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });
      const json = await res.json();
      const item = json.data;

      expect(item.id).toBe("tournament-1");
      expect(item.name).toBe("KL Open Rapid 2026");
      expect(item.description).toBe("Annual rapid chess championship");
      expect(item.venue).toEqual({
        name: "Kuala Lumpur Convention Centre",
        state: "Kuala Lumpur",
        address: "Jalan Pinang, 50450 Kuala Lumpur",
      });
      expect(item.start_date).toBe("2026-03-15");
      expect(item.end_date).toBe("2026-03-16");
      expect(item.registration_deadline).toBe("2026-03-10T23:59:59Z");
      expect(item.format).toEqual({
        type: "rapid",
        system: "swiss",
        rounds: 7,
      });
      expect(item.time_control).toEqual({
        base_minutes: 15,
        increment_seconds: 10,
        delay_seconds: 0,
      });
      expect(item.is_fide_rated).toBe(true);
      expect(item.is_mcf_rated).toBe(false);
      expect(item.entry_fees).toEqual({
        standard: { amount_cents: 5000 },
        additional: [],
      });
      expect(item.prizes).toEqual({ first: 2000, second: 1000, third: 500 });
      expect(item.restrictions).toEqual({
        min_rating: null,
        max_rating: 2200,
        min_age: null,
        max_age: null,
      });
      expect(item.max_participants).toBe(120);
      expect(item.status).toBe("published");
      expect(item.published_at).toBe("2026-03-01T00:00:00Z");
      expect(item.updated_at).toBe("2026-03-01T12:00:00Z");
    });

    it("includes a nested organization object with full info", async () => {
      setTournamentResult(makeTournament());

      const res = await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });
      const json = await res.json();
      const org = json.data.organization;

      expect(org.id).toBe("org-1");
      expect(org.name).toBe("KL Chess Association");
      expect(org.description).toBe("Premier chess org in KL");
      expect(org.links).toEqual(mockOrganization.links);
      expect(org.email).toBe("info@klchess.org");
      expect(org.phone).toBe("+60123456789");
    });

    it("does not expose raw organizations join or organization_id on the tournament item", async () => {
      setTournamentResult(makeTournament());

      const res = await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });
      const json = await res.json();

      expect(json.data).not.toHaveProperty("organizations");
      expect(json.data).not.toHaveProperty("organization_id");
    });

    it("sets organization to null when organizations join is null", async () => {
      setTournamentResult(makeTournament({ organizations: null }));

      const res = await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });
      const json = await res.json();

      expect(json.data.organization).toBeNull();
    });

    it("sets prizes to null when prizes is null", async () => {
      setTournamentResult(makeTournament({ prizes: null }));

      const res = await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });
      const json = await res.json();

      expect(json.data.prizes).toBeNull();
    });

    it("sets restrictions to null when restrictions is null", async () => {
      setTournamentResult(makeTournament({ restrictions: null }));

      const res = await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });
      const json = await res.json();

      expect(json.data.restrictions).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // current_participants
  // -------------------------------------------------------------------------

  describe("current_participants", () => {
    it("uses count aggregate for confirmed registrations", async () => {
      setTournamentResult(makeTournament());
      setRegistrationsCount(3);

      const res = await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });
      const json = await res.json();

      expect(json.data.current_participants).toBe(3);
    });

    it("defaults current_participants to 0 when count is null", async () => {
      setTournamentResult(makeTournament());
      setRegistrationsCount(null);

      const res = await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });
      const json = await res.json();

      expect(json.data.current_participants).toBe(0);
    });

    it("queries registrations filtered by tournament_id and status=confirmed", async () => {
      setTournamentResult(makeTournament());
      setRegistrationsCount(0);

      await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });

      const eqMock = mockRegistrationsBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("tournament_id", "tournament-1");
      expect(eqMock).toHaveBeenCalledWith("status", "confirmed");
    });
  });

  // -------------------------------------------------------------------------
  // Query behaviour
  // -------------------------------------------------------------------------

  describe("query behaviour", () => {
    it("queries by id and status=published", async () => {
      setTournamentResult(makeTournament());

      await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });

      const eqMock = mockTournamentBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("id", "tournament-1");
      expect(eqMock).toHaveBeenCalledWith("status", "published");
    });

    it("calls .single() on the tournament query", async () => {
      setTournamentResult(makeTournament());

      await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });

      const singleMock = mockTournamentBuilder.single as ReturnType<
        typeof vi.fn
      >;
      expect(singleMock).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("returns 404 when tournament is not found", async () => {
      setTournamentResult(null, { code: "PGRST116", message: "No rows found" });

      const res = await GET(makeRequest("nonexistent-id"), {
        params: Promise.resolve({ id: "nonexistent-id" }),
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe("Tournament not found");
    });

    it("returns 500 when Supabase returns a non-404 error", async () => {
      setTournamentResult(null, {
        code: "500",
        message: "DB connection failed",
      });

      const res = await GET(makeRequest("tournament-1"), {
        params: Promise.resolve({ id: "tournament-1" }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("DB connection failed");
    });
  });
});
