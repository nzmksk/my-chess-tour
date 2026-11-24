import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockFrom, mockRpc, mockGetClaims, mockHasPermission, tables } =
  vi.hoisted(() => {
    const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
    function makeBuilder(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "maybeSingle", "single"])
        b[m] = vi.fn(() => b);
      b.then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) =>
        Promise.resolve(
          tables[table]?.shift() ?? { data: null, error: null },
        ).then(onfulfilled, onrejected);
      return b;
    }
    return {
      tables,
      mockFrom: vi.fn((table: string) => makeBuilder(table)),
      mockRpc: vi.fn(),
      mockGetClaims: vi.fn(),
      mockHasPermission: vi.fn(),
    };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetClaims,
  hasOrgPermission: mockHasPermission,
}));

import { POST } from "../route";

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const T_ID = "cccccccc-0000-4000-8000-000000000001";
const AWARD_ID = "eeeeeeee-0000-4000-8000-000000000001";

const withdraw = (ids: { id?: string; awardId?: string } = {}) => {
  const id = ids.id ?? T_ID;
  const awardId = ids.awardId ?? AWARD_ID;
  return POST(
    new NextRequest(
      `http://localhost/api/v1/organizations/${ORG_ID}/tournaments/${id}/prize-awards/${awardId}/withdraw`,
      { method: "POST" },
    ),
    { params: Promise.resolve({ orgId: ORG_ID, id, awardId }) },
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  mockGetClaims.mockResolvedValue({ id: USER_ID });
  mockHasPermission.mockResolvedValue(true);
  tables.organizations = [
    { data: { id: ORG_ID, approval_status: "approved" }, error: null },
  ];
  tables.tournaments = [{ data: { id: T_ID }, error: null }];
  mockRpc.mockResolvedValue({
    data: { id: AWARD_ID, withdrawn_at: "2026-11-24T10:00:00Z" },
    error: null,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST prize-awards/[awardId]/withdraw", () => {
  it("withdraws the award through withdraw_prize_award as the caller", async () => {
    const res = await withdraw();
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("withdraw_prize_award", {
      p_tournament_id: T_ID,
      p_award_id: AWARD_ID,
      p_withdrawn_by: USER_ID,
    });
    expect((await res.json()).data.id).toBe(AWARD_ID);
  });

  it("requires payout.request", async () => {
    mockHasPermission.mockResolvedValue(false);
    const res = await withdraw();
    expect(res.status).toBe(403);
    expect(mockHasPermission).toHaveBeenCalledWith(
      USER_ID,
      ORG_ID,
      "payout.request",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed award id", async () => {
    const res = await withdraw({ awardId: "nope" });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("404s a tournament of another organization", async () => {
    tables.tournaments = [{ data: null, error: null }];
    const res = await withdraw();
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("404s an award that isn't in the tournament", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "not found" },
    });
    const res = await withdraw();
    expect(res.status).toBe(404);
  });

  it("409s an award an admin has already approved, with a readable message", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "PRIZE_AWARD_NOT_WITHDRAWABLE: approved",
      },
    });
    const res = await withdraw();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("PRIZE_AWARD_REFUSED");
    expect(json.error.message).toMatch(/already approved/);
  });

  it("500s an unexpected database error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "boom" },
    });
    const res = await withdraw();
    expect(res.status).toBe(500);
  });
});
