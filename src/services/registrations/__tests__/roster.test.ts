import { beforeEach, describe, expect, it, vi } from "vitest";

const { builders, mockFrom, mockRpc } = vi.hoisted(() => {
  function makeBuilder() {
    const b: Record<string, unknown> & {
      result: { data: unknown; error: unknown };
    } = { result: { data: null, error: null } };
    for (const m of ["select", "eq", "in", "order"]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) => Promise.resolve(b.result).then(onfulfilled, onrejected);
    return b;
  }

  const builders = {
    registrations: makeBuilder(),
    users: makeBuilder(),
    player_profiles: makeBuilder(),
  };

  return {
    builders,
    mockFrom: vi.fn((table: keyof typeof builders) => builders[table]),
    mockRpc: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

import {
  loadRoster,
  pickFideRating,
  rosterDisplayName,
  type RosterEntry,
} from "../roster";

const TOUR_ID = "cccccccc-0000-0000-0000-000000000001";
const ALICE = "aaaaaaaa-0000-0000-0000-000000000001";
const BOB = "aaaaaaaa-0000-0000-0000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  for (const b of Object.values(builders)) {
    b.result = { data: [], error: null };
  }
  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe("pickFideRating", () => {
  const all = { standard: 1800, rapid: 1750, blitz: 1700 };

  it("uses the rating for the tournament's time control", () => {
    expect(pickFideRating(all, "standard")).toBe(1800);
    expect(pickFideRating(all, "rapid")).toBe(1750);
    expect(pickFideRating(all, "blitz")).toBe(1700);
  });

  it("falls back to slower time controls, never faster", () => {
    expect(pickFideRating({ standard: 1800 }, "blitz")).toBe(1800);
    expect(pickFideRating({ rapid: 1750 }, "blitz")).toBe(1750);
    expect(pickFideRating({ blitz: 1700 }, "rapid")).toBeNull();
    expect(pickFideRating({ rapid: 1750 }, "standard")).toBeNull();
  });

  it("is null for an unrated player", () => {
    expect(pickFideRating(null, "rapid")).toBeNull();
  });
});

describe("rosterDisplayName", () => {
  const base = { first_name: "Alice", last_name: "Tan" } as RosterEntry;

  it("joins first and last name", () => {
    expect(rosterDisplayName(base)).toBe("Alice Tan");
  });

  it("says Unknown for a player whose account is gone", () => {
    expect(
      rosterDisplayName({ ...base, first_name: null, last_name: null }),
    ).toBe("Unknown");
  });
});

describe("loadRoster", () => {
  it("sweeps lapsed checkouts before reading the live registrations", async () => {
    await loadRoster(TOUR_ID, "rapid");

    expect(mockRpc).toHaveBeenCalledWith(
      "expire_stale_pending_payments",
      expect.objectContaining({ p_tournament_id: TOUR_ID }),
    );
    expect(builders.registrations.in).toHaveBeenCalledWith("status", [
      "confirmed",
      "pending_payment",
    ]);
    expect(builders.registrations.order).toHaveBeenCalledWith("registered_at", {
      ascending: true,
    });
  });

  it("still loads when the sweep fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await loadRoster(TOUR_ID, "rapid");
    expect(result).toEqual({ ok: true, entries: [] });
  });

  it("joins each registration to its player, in registration order", async () => {
    builders.registrations.result = {
      data: [
        {
          id: "r1",
          user_id: ALICE,
          fee_tier: "standard",
          status: "confirmed",
          registered_at: "2026-11-01T02:00:00+00:00",
        },
        {
          id: "r2",
          user_id: BOB,
          fee_tier: "junior",
          status: "pending_payment",
          registered_at: "2026-11-02T02:00:00+00:00",
        },
      ],
      error: null,
    };
    builders.users.result = {
      data: [
        { id: ALICE, first_name: "Alice", last_name: "Tan" },
        { id: BOB, first_name: "Bob", last_name: "Lim" },
      ],
      error: null,
    };
    builders.player_profiles.result = {
      data: [
        {
          user_id: ALICE,
          fide_id: 5701234,
          fide_rating: { standard: 1800, rapid: 1750 },
          mcf_id: 1234,
          national_rating: 1690,
        },
      ],
      error: null,
    };

    const result = await loadRoster(TOUR_ID, "rapid");

    expect(result).toEqual({
      ok: true,
      entries: [
        {
          index: 1,
          registration_id: "r1",
          user_id: ALICE,
          first_name: "Alice",
          last_name: "Tan",
          fide_id: 5701234,
          fide_rating: 1750,
          mcf_id: 1234,
          national_rating: 1690,
          fee_tier: "standard",
          status: "confirmed",
          registered_at: "2026-11-01T02:00:00+00:00",
        },
        {
          index: 2,
          registration_id: "r2",
          user_id: BOB,
          first_name: "Bob",
          last_name: "Lim",
          fide_id: null,
          fide_rating: null,
          mcf_id: null,
          national_rating: null,
          fee_tier: "junior",
          status: "pending_payment",
          registered_at: "2026-11-02T02:00:00+00:00",
        },
      ],
    });
  });

  it("skips the player lookups when nobody has registered", async () => {
    await loadRoster(TOUR_ID, "rapid");
    expect(mockFrom).not.toHaveBeenCalledWith("users");
    expect(mockFrom).not.toHaveBeenCalledWith("player_profiles");
  });

  it.each(["registrations", "users", "player_profiles"] as const)(
    "fails rather than return a partial roster when %s can't be read",
    async (table) => {
      builders.registrations.result = {
        data: [
          {
            id: "r1",
            user_id: ALICE,
            fee_tier: "standard",
            status: "confirmed",
            registered_at: "2026-11-01T02:00:00+00:00",
          },
        ],
        error: null,
      };
      const error = { message: "db down" };
      builders[table].result = { data: null, error };

      const result = await loadRoster(TOUR_ID, "rapid");
      expect(result).toEqual({ ok: false, context: table, error });
    },
  );
});
