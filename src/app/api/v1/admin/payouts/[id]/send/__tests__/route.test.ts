import { beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";

const { mockGetClaims, mockRpc, mockLoad, mockExecute } = vi.hoisted(() => ({
  mockGetClaims: vi.fn(),
  mockRpc: vi.fn(),
  mockLoad: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = mockLoad;
  return { supabaseAdmin: { from: vi.fn(() => builder) } };
});

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
    rpc: mockRpc,
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

vi.mock("@/services/payouts/execute", () => ({ executePayout: mockExecute }));

import { POST } from "../route";

const ADMIN_USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PAYOUT_ID = "bbbbbbbb-0000-0000-0000-000000000001";

const send = (id = PAYOUT_ID) =>
  POST(new Request(`http://localhost/api/v1/admin/payouts/${id}/send`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

function givenPayout(overrides: Record<string, unknown> = {}) {
  mockLoad.mockResolvedValue({
    data: {
      approval: "approved",
      status: "pending",
      processed_at: null,
      chip_send_instruction_id: null,
      ...overrides,
    },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: ADMIN_USER_ID } },
    error: null,
  });
  mockRpc.mockResolvedValue({ data: true, error: null });
  givenPayout();
  mockExecute.mockResolvedValue("sent");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/v1/admin/payouts/[id]/send", () => {
  it("rejects a malformed id", async () => {
    expect((await send("nope")).status).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("requires a signed-in platform admin", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    expect((await send()).status).toBe(401);

    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: ADMIN_USER_ID } },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: false, error: null });
    expect((await send()).status).toBe(403);
    expect(mockRpc).toHaveBeenCalledWith("has_global_permission", {
      p_user_id: appIdFor(ADMIN_USER_ID),
      p_permission: "platform.manage",
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("re-runs the send and reports what happened", async () => {
    mockExecute.mockResolvedValue("awaiting_budget");
    const res = await send();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { payout_id: PAYOUT_ID, outcome: "awaiting_budget" },
    });
    expect(mockExecute).toHaveBeenCalledWith(PAYOUT_ID);
  });

  it("finishes a send an earlier run claimed but lost track of", async () => {
    givenPayout({ status: "processing" });
    expect((await send()).status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(PAYOUT_ID);
  });

  it("404s an unknown payout", async () => {
    mockLoad.mockResolvedValue({ data: null, error: null });
    expect((await send()).status).toBe(404);
  });

  it.each([
    ["awaiting review", { approval: "pending" }, "Only an approved payout"],
    ["out with CHIP", { status: "processing", chip_send_instruction_id: 8 }, "already with CHIP"],
    ["paid", { status: "paid", processed_at: "2026-11-01T00:00:00Z" }, "already with CHIP"],
  ])("refuses a payout that is %s", async (_label, overrides, message) => {
    givenPayout(overrides);
    const res = await send();
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain(message);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("reports a failed load", async () => {
    mockLoad.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect((await send()).status).toBe(500);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
