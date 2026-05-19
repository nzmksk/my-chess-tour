import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

// ---------------------------------------------------------------------------
// Mock Supabase server client (user auth)
// ---------------------------------------------------------------------------

const { mockGetUser } = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  return { mockGetUser };
});

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

// ---------------------------------------------------------------------------
// Mock Supabase admin client (data queries)
// ---------------------------------------------------------------------------

const { mockRegistrationsBuilder, mockFrom } = vi.hoisted(() => {
  function makeBuilder(finalResult: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {};
    const methods = ["select", "eq", "in", "order"];
    for (const m of methods) {
      chain[m] = vi.fn(() => chain);
    }
    chain.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) => Promise.resolve(finalResult).then(onfulfilled, onrejected);
    return chain;
  }

  const mockRegistrationsBuilder = makeBuilder({ data: [], error: null });
  const mockFrom = vi.fn(() => mockRegistrationsBuilder);
  return { mockRegistrationsBuilder, mockFrom };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTHENTICATED_USER = { id: "user-123" };

function makeRegistration(overrides: Record<string, unknown> = {}) {
  return {
    id: "reg-1",
    fee_tier: "standard",
    status: "confirmed",
    registered_at: "2026-02-22T12:00:00Z",
    confirmed_at: "2026-02-22T12:01:30Z",
    tournaments: {
      id: "tournament-1",
      name: "KL Open Rapid 2026",
      start_date: "2026-03-15",
      venue_name: "Kuala Lumpur Convention Centre",
      venue_state: "Kuala Lumpur",
      format: { type: "rapid", system: "swiss", rounds: 7 },
      time_control: {
        base_minutes: 10,
        increment_seconds: 5,
        delay_seconds: 0,
      },
      entry_fees: { standard: { amount_cents: 5000 }, additional: [] },
      status: "published",
    },
    ...overrides,
  };
}

function makeRequest(url = "http://localhost/api/v1/player/registrations") {
  return new NextRequest(url);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setQueryResult(data: unknown, error: unknown = null) {
  const result = { data, error };
  (mockRegistrationsBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/player/registrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: AUTHENTICATED_USER } });
    setQueryResult([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("queries registrations for the authenticated user only", async () => {
      setQueryResult([]);

      await GET(makeRequest());

      const eqMock = mockRegistrationsBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("user_id", AUTHENTICATED_USER.id);
    });
  });

  describe("response shape", () => {
    it("returns 200 with data, next_cursor, and has_more", async () => {
      setQueryResult([makeRegistration()]);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toHaveProperty("data");
      expect(json).toHaveProperty("next_cursor", null);
      expect(json).toHaveProperty("has_more", false);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it("shapes each registration item correctly", async () => {
      setQueryResult([makeRegistration()]);

      const res = await GET(makeRequest());
      const json = await res.json();
      const item = json.data[0];

      expect(item.id).toBe("reg-1");
      expect(item.fee_tier).toBe("standard");
      expect(item.status).toBe("confirmed");
      expect(item.registered_at).toBe("2026-02-22T12:00:00Z");
      expect(item.confirmed_at).toBe("2026-02-22T12:01:30Z");
      expect(item.tournament).toEqual({
        id: "tournament-1",
        name: "KL Open Rapid 2026",
        start_date: "2026-03-15",
        venue_name: "Kuala Lumpur Convention Centre",
        venue_state: "Kuala Lumpur",
        format: { type: "rapid", system: "swiss", rounds: 7 },
        time_control: {
          base_minutes: 10,
          increment_seconds: 5,
          delay_seconds: 0,
        },
        status: "published",
      });
    });

    it("computes entry_fee_cents from standard fee tier", async () => {
      setQueryResult([makeRegistration({ fee_tier: "standard" })]);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(json.data[0].entry_fee_cents).toBe(5000);
    });

    it("computes entry_fee_cents from additional fee tier", async () => {
      setQueryResult([
        makeRegistration({
          fee_tier: "early_bird",
          tournaments: {
            id: "tournament-1",
            name: "KL Open Rapid 2026",
            start_date: "2026-03-15",
            venue_name: "KLCC",
            venue_state: "Kuala Lumpur",
            format: { type: "rapid", system: "swiss", rounds: 7 },
            time_control: {
              base_minutes: 10,
              increment_seconds: 5,
              delay_seconds: 0,
            },
            entry_fees: {
              standard: { amount_cents: 5000 },
              additional: [
                {
                  type: "early_bird",
                  amount_cents: 3500,
                  valid_until: "2026-03-01",
                },
              ],
            },
            status: "published",
          },
        }),
      ]);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(json.data[0].entry_fee_cents).toBe(3500);
    });

    it("sets entry_fee_cents to null for unknown fee tier", async () => {
      setQueryResult([makeRegistration({ fee_tier: "unknown_tier" })]);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(json.data[0].entry_fee_cents).toBeNull();
    });

    it("returns empty data array when there are no registrations", async () => {
      setQueryResult([]);

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toEqual([]);
    });
  });

  describe("status filter", () => {
    it("applies status filter when provided", async () => {
      setQueryResult([]);
      const req = makeRequest(
        "http://localhost/api/v1/player/registrations?status=confirmed",
      );

      await GET(req);

      const inMock = mockRegistrationsBuilder.in as ReturnType<typeof vi.fn>;
      expect(inMock).toHaveBeenCalledWith("status", ["confirmed"]);
    });

    it("accepts comma-separated status values", async () => {
      setQueryResult([]);
      const req = makeRequest(
        "http://localhost/api/v1/player/registrations?status=confirmed,pending_payment",
      );

      await GET(req);

      const inMock = mockRegistrationsBuilder.in as ReturnType<typeof vi.fn>;
      expect(inMock).toHaveBeenCalledWith("status", [
        "confirmed",
        "pending_payment",
      ]);
    });

    it("returns 400 for invalid status value", async () => {
      const req = makeRequest(
        "http://localhost/api/v1/player/registrations?status=invalid_status",
      );

      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("does not apply status filter when not provided", async () => {
      setQueryResult([]);

      await GET(makeRequest());

      const inMock = mockRegistrationsBuilder.in as ReturnType<typeof vi.fn>;
      expect(inMock).not.toHaveBeenCalled();
    });
  });

  describe("sorting", () => {
    it("defaults to sorting by registered_at descending", async () => {
      setQueryResult([]);

      await GET(makeRequest());

      const orderMock = mockRegistrationsBuilder.order as ReturnType<
        typeof vi.fn
      >;
      expect(orderMock).toHaveBeenCalledWith("registered_at", {
        ascending: false,
      });
    });

    it("sorts ascending when order=asc", async () => {
      setQueryResult([]);
      const req = makeRequest(
        "http://localhost/api/v1/player/registrations?sort=registered_at&order=asc",
      );

      await GET(req);

      const orderMock = mockRegistrationsBuilder.order as ReturnType<
        typeof vi.fn
      >;
      expect(orderMock).toHaveBeenCalledWith("registered_at", {
        ascending: true,
      });
    });

    it("returns 400 for invalid sort field", async () => {
      const req = makeRequest(
        "http://localhost/api/v1/player/registrations?sort=invalid_field",
      );

      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid order value", async () => {
      const req = makeRequest(
        "http://localhost/api/v1/player/registrations?order=sideways",
      );

      const res = await GET(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("error handling", () => {
    it("returns 500 when Supabase returns an error", async () => {
      setQueryResult(null, { message: "DB connection failed" });

      const res = await GET(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error.code).toBe("INTERNAL_ERROR");
      expect(json.error.message).toBe("DB connection failed");
    });
  });
});
