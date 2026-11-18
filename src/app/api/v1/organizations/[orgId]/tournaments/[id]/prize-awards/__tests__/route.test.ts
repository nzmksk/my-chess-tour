import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockFrom,
  mockRpc,
  mockGetClaims,
  mockHasPermission,
  mockListAwards,
  mockLoadPool,
  mockNotifyAdmins,
  tables,
} = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "maybeSingle", "single"]) b[m] = vi.fn(() => b);
    b.then = (onfulfilled: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
      Promise.resolve(tables[table]?.shift() ?? { data: null, error: null }).then(onfulfilled, onrejected);
    return b;
  }
  return {
    tables,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockRpc: vi.fn(),
    mockGetClaims: vi.fn(),
    mockHasPermission: vi.fn(),
    mockListAwards: vi.fn(),
    mockLoadPool: vi.fn(),
    mockNotifyAdmins: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({ supabaseAdmin: { from: mockFrom, rpc: mockRpc } }));
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetClaims,
  hasOrgPermission: mockHasPermission,
}));
vi.mock("@/services/prizes/awards", () => ({ listTournamentAwards: mockListAwards }));
vi.mock("@/services/prizes/pool", () => ({ loadPrizePoolPosition: mockLoadPool }));
vi.mock("@/services/prizes/notify", () => ({ notifyAdminsOfPrizes: mockNotifyAdmins }));

import { runAfterCallbacks } from "@/test/after";
import { GET, POST } from "../route";

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const T_ID = "cccccccc-0000-4000-8000-000000000001";
const WINNER = "dddddddd-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ orgId: ORG_ID, id: T_ID }) };
const url = `http://localhost/api/v1/organizations/${ORG_ID}/tournaments/${T_ID}/prize-awards`;

const post = (body: unknown) =>
  POST(
    new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );

const VALID = { user_id: WINNER, category: "Open", place: "1st", amount_cents: 30000 };

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  mockGetClaims.mockResolvedValue({ id: USER_ID });
  mockHasPermission.mockResolvedValue(true);
  tables.organizations = [{ data: { id: ORG_ID, approval_status: "approved" }, error: null }];
  tables.tournaments = [{ data: { id: T_ID }, error: null }];
  mockRpc.mockResolvedValue({ data: "award-1", error: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST prize-awards", () => {
  it("enters the winner through enter_prize_award and alerts admins after the response", async () => {
    const res = await post(VALID);
    expect(res.status).toBe(201);
    expect(mockHasPermission).toHaveBeenCalledWith(USER_ID, ORG_ID, "payout.request");
    expect(mockRpc).toHaveBeenCalledWith("enter_prize_award", {
      p_tournament_id: T_ID,
      p_user_id: WINNER,
      p_category: "Open",
      p_place: "1st",
      p_amount_cents: 30000,
      p_entered_by: USER_ID,
    });
    expect(mockNotifyAdmins).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(mockNotifyAdmins).toHaveBeenCalledWith(T_ID, "prize_review", 30000, "Open — 1st");
  });

  it("enters a special prize with no place", async () => {
    await post({ user_id: WINNER, category: "Best Junior", amount_cents: 5000 });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_category: "Best Junior", p_place: null });
  });

  it("explains a refusal in plain words", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "PRIZE_AWARD_NOT_ALLOWED: winner_not_registered" },
    });
    const res = await post(VALID);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe(
      "The winner must be a confirmed participant of this tournament.",
    );
  });

  it("409s the same winner twice for one prize", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "23505", message: "dup" } });
    const res = await post(VALID);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("ALREADY_AWARDED");
  });

  it("needs payout.request", async () => {
    mockHasPermission.mockResolvedValue(false);
    expect((await post(VALID)).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("404s another organization's tournament", async () => {
    tables.tournaments = [{ data: null, error: null }];
    expect((await post(VALID)).status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each<[Record<string, unknown>, string]>([
    [{ ...VALID, user_id: "nope" }, "bad winner id"],
    [{ ...VALID, category: " " }, "blank category"],
    [{ ...VALID, amount_cents: 0 }, "zero amount"],
    [{ ...VALID, place: 3 }, "numeric place"],
  ])("400 on %o (%s)", async (body: Record<string, unknown>) => {
    expect((await post(body)).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("GET prize-awards", () => {
  it("returns the awards and the pool to payout viewers", async () => {
    mockListAwards.mockResolvedValue({ ok: true, awards: [{ id: "award-1" }] });
    mockLoadPool.mockResolvedValue({ ok: true, position: { distribution: "platform" } });
    const res = await GET(new NextRequest(url), params);
    expect(res.status).toBe(200);
    expect(mockHasPermission).toHaveBeenCalledWith(USER_ID, ORG_ID, "payout.view");
    expect((await res.json()).data).toEqual({
      pool: { distribution: "platform" },
      awards: [{ id: "award-1" }],
    });
  });
});
