import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockRpc, mockFrom, mockGetClaims, mockUserRpc, mockExecute, mockNotifyAwarded, tables } =
  vi.hoisted(() => {
    const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
    function makeBuilder(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "maybeSingle"]) b[m] = vi.fn(() => b);
      b.then = (onfulfilled: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
        Promise.resolve(tables[table]?.shift() ?? { data: null, error: null }).then(onfulfilled, onrejected);
      return b;
    }
    return {
      tables,
      mockRpc: vi.fn(),
      mockFrom: vi.fn((table: string) => makeBuilder(table)),
      mockGetClaims: vi.fn(),
      mockUserRpc: vi.fn(),
      mockExecute: vi.fn(),
      mockNotifyAwarded: vi.fn(),
    };
  });

vi.mock("@/services/supabase/admin", () => ({ supabaseAdmin: { rpc: mockRpc, from: mockFrom } }));
vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: mockUserRpc }),
}));
vi.mock("@/services/supabase/permission", () => ({ getAuthClaims: mockGetClaims }));
vi.mock("@/services/prizes/execute", () => ({ executePrizeAward: mockExecute }));
vi.mock("@/services/prizes/notify", () => ({ notifyPrizeAwarded: mockNotifyAwarded }));

import { runAfterCallbacks } from "@/test/after";
import { PATCH } from "../route";
import { POST as SEND } from "../send/route";

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const AWARD = "eeeeeeee-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ id: AWARD }) };

const patch = (body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/v1/admin/prize-awards/${AWARD}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  mockGetClaims.mockResolvedValue({ id: ADMIN });
  mockUserRpc.mockResolvedValue({ data: true, error: null });
  mockRpc.mockResolvedValue({ data: { id: AWARD, approval: "approved" }, error: null });
  mockExecute.mockResolvedValue("sent");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("PATCH /api/v1/admin/prize-awards/[id]", () => {
  it("approves, sends the prize, and emails the winner after the response", async () => {
    const res = await patch({ action: "approve" });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("review_prize_award", {
      p_award_id: AWARD,
      p_reviewer_id: ADMIN,
      p_action: "approve",
      p_rejection_reason: null,
    });
    expect((await res.json()).data.outcome).toBe("sent");
    await runAfterCallbacks();
    expect(mockExecute).toHaveBeenCalledWith(AWARD);
    expect(mockNotifyAwarded).toHaveBeenCalledWith(AWARD);
  });

  it("rejects with a reason and sends nothing", async () => {
    mockRpc.mockResolvedValue({ data: { id: AWARD, approval: "rejected" }, error: null });
    const res = await patch({ action: "reject", rejection_reason: " Wrong player " });
    expect(res.status).toBe(200);
    expect(mockRpc.mock.calls[0][1].p_rejection_reason).toBe("Wrong player");
    await runAfterCallbacks();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockNotifyAwarded).not.toHaveBeenCalled();
  });

  it("refuses an award beyond the collected pool, in plain words", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message:
          "PRIZE_AWARD_EXCEEDS_POOL: 7500 cents requested, 2500 cents of the collected pool is uncommitted",
      },
    });
    const res = await patch({ action: "approve" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe(
      "This award is RM 75.00, but only RM 25.00 of the collected pool is uncommitted.",
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("needs a reason to reject", async () => {
    expect((await patch({ action: "reject" })).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("is for platform admins only", async () => {
    mockUserRpc.mockResolvedValue({ data: false, error: null });
    expect((await patch({ action: "approve" })).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("404s a missing award", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "not found" } });
    expect((await patch({ action: "approve" })).status).toBe(404);
  });
});

describe("POST /api/v1/admin/prize-awards/[id]/send", () => {
  const send = () => SEND(new Request(`http://localhost/api/v1/admin/prize-awards/${AWARD}/send`), params);

  it("re-runs an approved award that hasn't gone out", async () => {
    tables.prize_awards = [
      { data: { approval: "approved", status: "pending", processed_at: null, chip_send_instruction_id: null }, error: null },
    ];
    const res = await send();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ award_id: AWARD, outcome: "sent" });
  });

  it("refuses an award already with CHIP", async () => {
    tables.prize_awards = [
      { data: { approval: "approved", status: "processing", processed_at: null, chip_send_instruction_id: 7001 }, error: null },
    ];
    expect((await send()).status).toBe(409);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("refuses an unapproved award", async () => {
    tables.prize_awards = [
      { data: { approval: "pending", status: "pending", processed_at: null, chip_send_instruction_id: null }, error: null },
    ];
    expect((await send()).status).toBe(409);
  });
});
