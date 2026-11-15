import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { builders, mockFrom, mockRpc, mockGetAuthClaims, mockHasGlobal } =
  vi.hoisted(() => {
    function makeBuilder() {
      const b: Record<string, unknown> & {
        result: { data: unknown; error: unknown; count?: number };
      } = { result: { data: null, error: null } };
      for (const m of ["select", "eq", "in", "is", "order", "single", "limit"]) {
        b[m] = vi.fn(() => b);
      }
      b.then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) => Promise.resolve(b.result).then(onfulfilled, onrejected);
      return b;
    }

    const builders = {
      organizations: makeBuilder(),
      organization_memberships: makeBuilder(),
      tournaments: makeBuilder(),
      registrations: makeBuilder(),
      users: makeBuilder(),
      player_profiles: makeBuilder(),
      tournament_cancellation_requests: makeBuilder(),
      payments: makeBuilder(),
    };

    return {
      builders,
      mockFrom: vi.fn((table: keyof typeof builders) => builders[table]),
      mockRpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      mockGetAuthClaims: vi.fn(),
      mockHasGlobal: vi.fn(),
    };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetAuthClaims,
  hasGlobalPermission: mockHasGlobal,
}));

import {
  getAdminTournamentManageData,
  getTournamentManageData,
} from "../getTournamentManageData";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TOUR_ID = "cccccccc-0000-0000-0000-000000000001";

const DRAFT_TOURNAMENT = {
  id: TOUR_ID,
  name: "Draft Open",
  description: null,
  status: "draft",
  start_date: "2026-12-01",
  end_date: "2026-12-02",
  registration_deadline: null,
  registration_closed_at: null,
  venue_name: "KL Convention Centre",
  venue_state: "W.P. Kuala Lumpur",
  venue_address: null,
  venue_country: "MY",
  timezone: "Asia/Kuala_Lumpur",
  format: { type: "rapid", system: "swiss", rounds: 7 },
  time_control: null,
  is_fide_rated: false,
  is_mcf_rated: false,
  max_participants: 64,
  entry_fees: null,
  prizes: null,
  restrictions: null,
  organization_id: ORG_ID,
  organization: { name: "KL Chess Club" },
  beneficiary_organization_id: null,
  beneficiary_accepted_at: null,
  beneficiary: null,
};

function eqCalls(table: keyof typeof builders) {
  return (builders[table].eq as ReturnType<typeof vi.fn>).mock.calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const b of Object.values(builders)) {
    b.result = { data: null, error: null };
  }
  builders.tournaments.result = { data: DRAFT_TOURNAMENT, error: null };
  builders.registrations.result = { data: [], error: null };
  builders.tournament_cancellation_requests.result = {
    data: null,
    error: null,
    count: 0,
  };
  builders.payments.result = { data: null, error: null, count: 0 };
  mockGetAuthClaims.mockResolvedValue({ id: USER_ID });
  mockHasGlobal.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getAdminTournamentManageData", () => {
  it("rejects a malformed tournament id", async () => {
    const result = await getAdminTournamentManageData("not-a-uuid");
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const result = await getAdminTournamentManageData(TOUR_ID);
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuses a user without platform.manage before reading anything", async () => {
    mockHasGlobal.mockResolvedValue(false);
    const result = await getAdminTournamentManageData(TOUR_ID);
    expect(mockHasGlobal).toHaveBeenCalledWith(USER_ID, "platform.manage");
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("loads a draft tournament of any org without an org membership check", async () => {
    const result = await getAdminTournamentManageData(TOUR_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tournament.status).toBe("draft");
    expect(result.data.tournament.organization).toEqual({
      id: ORG_ID,
      name: "KL Chess Club",
    });
    expect(mockFrom).not.toHaveBeenCalledWith("organization_memberships");
    expect(eqCalls("tournaments")).toEqual([["id", TOUR_ID]]);
  });

  it("returns 404 when the tournament does not exist", async () => {
    builders.tournaments.result = {
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    };
    const result = await getAdminTournamentManageData(TOUR_ID);
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});

describe("getTournamentManageData", () => {
  it("still scopes the tournament read to the manager's organization", async () => {
    builders.organizations.result = {
      data: { id: ORG_ID, approval_status: "approved" },
      error: null,
    };
    builders.organization_memberships.result = {
      data: { roles: { name: "owner" } },
      error: null,
    };

    const result = await getTournamentManageData(ORG_ID, TOUR_ID);

    expect(result.ok).toBe(true);
    expect(mockHasGlobal).not.toHaveBeenCalled();
    expect(eqCalls("tournaments")).toEqual([
      ["id", TOUR_ID],
      ["organization_id", ORG_ID],
    ]);
  });
});

describe("hasPaidRegistration", () => {
  it("is false when no registration payment has settled", async () => {
    const result = await getAdminTournamentManageData(TOUR_ID);
    expect(result.ok && result.data.hasPaidRegistration).toBe(false);
  });

  // A refunded registration is forfeited, so nobody is confirmed, but its
  // payment row stays 'paid' and the API still locks the paid-stage fields.
  it("is true for a paid registration that is no longer confirmed", async () => {
    builders.registrations.result = { data: [], error: null };
    builders.payments.result = { data: null, error: null, count: 1 };

    const result = await getAdminTournamentManageData(TOUR_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.stats.confirmed).toBe(0);
    expect(result.data.hasPaidRegistration).toBe(true);
    expect(eqCalls("payments")).toEqual([
      ["tournament_id", TOUR_ID],
      ["type", "registration"],
      ["status", "paid"],
    ]);
  });

  it("fails the load rather than guess when the check fails", async () => {
    builders.payments.result = {
      data: null,
      error: { message: "db down" },
    };
    const result = await getAdminTournamentManageData(TOUR_ID);
    expect(result).toMatchObject({ ok: false, status: 500 });
  });
});
