import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

const { mockTournamentsBuilder, mockRpc, mockFrom } = vi.hoisted(() => {
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
  const mockRpc = vi.fn().mockResolvedValue({ data: [] });
  const mockFrom = vi.fn(() => mockTournamentsBuilder);
  return { mockTournamentsBuilder, mockRpc, mockFrom };
});

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTournament(overrides: Record<string, unknown> = {}) {
  return {
    id: "tournament-1",
    organization_id: "org-1",
    name: "KL Open Rapid 2026",
    venue_name: "Kuala Lumpur Convention Centre",
    venue_state: "Kuala Lumpur",
    start_date: "2026-03-15",
    end_date: "2026-03-16",
    format: { type: "rapid", system: "swiss", rounds: 7 },
    time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 0 },
    is_fide_rated: true,
    is_mcf_rated: false,
    entry_fees: { standard: { amount_cents: 5000 }, additional: [] },
    restrictions: null,
    max_participants: 120,
    status: "published",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/tournaments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTournamentsResult([]);
    mockRpc.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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
      expect(item.organization_id).toBe("org-1");
      expect(item.name).toBe("KL Open Rapid 2026");
      expect(item.venue).toEqual({
        name: "Kuala Lumpur Convention Centre",
        state: "Kuala Lumpur",
      });
      expect(item.start_date).toBe("2026-03-15");
      expect(item.end_date).toBe("2026-03-16");
      expect(item.format).toEqual({ type: "rapid", system: "swiss", rounds: 7 });
      expect(item.is_fide_rated).toBe(true);
      expect(item.is_mcf_rated).toBe(false);
      expect(item.max_participants).toBe(120);
      expect(item.status).toBe("published");
    });

    it("returns an empty data array when there are no matching tournaments", async () => {
      setTournamentsResult([]);

      const res = await GET();
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toEqual([]);
    });
  });

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

  describe("current_participants", () => {
    it("uses RPC to count confirmed registrations per tournament", async () => {
      setTournamentsResult([makeTournament({ id: "t-1" }), makeTournament({ id: "t-2" })]);
      mockRpc.mockResolvedValue({
        data: [
          { tournament_id: "t-1", count: 2 },
          { tournament_id: "t-2", count: 1 },
        ],
      });

      const res = await GET();
      const json = await res.json();

      const t1 = json.data.find((t: { id: string }) => t.id === "t-1");
      const t2 = json.data.find((t: { id: string }) => t.id === "t-2");
      expect(t1.current_participants).toBe(2);
      expect(t2.current_participants).toBe(1);
    });

    it("defaults current_participants to 0 when there are no confirmed registrations", async () => {
      setTournamentsResult([makeTournament()]);
      mockRpc.mockResolvedValue({ data: [] });

      const res = await GET();
      const json = await res.json();

      expect(json.data[0].current_participants).toBe(0);
    });

    it("skips the RPC query when there are no tournaments", async () => {
      setTournamentsResult([]);

      await GET();

      // rpc should not have been called (no tournament IDs to count)
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

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
