import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockGetClaims, mockIsAdmin, mockRpc, mockLoadQueue, mockExecute } =
  vi.hoisted(() => ({
    mockGetClaims: vi.fn(),
    mockIsAdmin: vi.fn(),
    mockRpc: vi.fn(),
    mockLoadQueue: vi.fn(),
    mockExecute: vi.fn(),
  }));

vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetClaims,
}));
vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: mockIsAdmin }),
}));
vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));
vi.mock("@/services/payouts/admin-queue", () => ({
  loadAdminPayoutQueue: mockLoadQueue,
}));
vi.mock("@/services/payouts/execute", () => ({
  executePayout: mockExecute,
}));

import { GET, POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const TOURNAMENT_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const PAYOUT_ID = "cccccccc-0000-4000-8000-000000000001";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/v1/admin/payouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({ id: ADMIN_ID });
  mockIsAdmin.mockResolvedValue({ data: true, error: null });
  mockRpc.mockResolvedValue({ data: PAYOUT_ID, error: null });
  mockExecute.mockResolvedValue("sent");
  mockLoadQueue.mockResolvedValue({
    data: { candidates: [], payouts: [] },
    error: null,
  });
});

// ---------------------------------------------------------------------------
// Auth, both verbs
// ---------------------------------------------------------------------------

describe.each([
  ["GET", () => GET()],
  ["POST", () => POST(post({ tournament_id: TOURNAMENT_ID }))],
])("%s auth", (_verb, call) => {
  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("checks platform.manage, and 403s without it", async () => {
    mockIsAdmin.mockResolvedValue({ data: false, error: null });
    expect((await call()).status).toBe(403);
    expect(mockIsAdmin).toHaveBeenCalledWith("has_global_permission", {
      p_user_id: ADMIN_ID,
      p_permission: "platform.manage",
    });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("500s when the permission check itself fails", async () => {
    mockIsAdmin.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect((await call()).status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe("GET", () => {
  it("returns the queue", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { candidates: [], payouts: [] } });
  });

  it("500s when the queue can't load", async () => {
    mockLoadQueue.mockResolvedValue({ data: null, error: "db down" });
    expect((await GET()).status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe("POST validation", () => {
  it.each([
    ["invalid JSON", "{nope"],
    ["a missing tournament_id", {}],
    ["a malformed tournament_id", { tournament_id: "nope" }],
    ["a zero amount", { tournament_id: TOURNAMENT_ID, amount_cents: 0 }],
    ["a negative amount", { tournament_id: TOURNAMENT_ID, amount_cents: -5 }],
    ["a fractional amount", { tournament_id: TOURNAMENT_ID, amount_cents: 10.5 }],
    ["a string amount", { tournament_id: TOURNAMENT_ID, amount_cents: "100" }],
  ])("400s on %s", async (_label, body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("POST", () => {
  it("queues, then executes, and reports the outcome", async () => {
    const res = await POST(post({ tournament_id: TOURNAMENT_ID, amount_cents: 5000 }));
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith("queue_payout", {
      p_tournament_id: TOURNAMENT_ID,
      p_kind: "automatic",
      p_amount_cents: 5000,
      p_requested_by: ADMIN_ID,
    });
    expect(mockExecute).toHaveBeenCalledWith(PAYOUT_ID);
    expect(await res.json()).toEqual({
      data: { payout_id: PAYOUT_ID, outcome: "sent" },
    });
  });

  it("treats an omitted amount as everything available", async () => {
    await POST(post({ tournament_id: TOURNAMENT_ID }));
    expect(mockRpc.mock.calls[0][1].p_amount_cents).toBeNull();
  });

  it("reports a parked payout as still 201, with its outcome", async () => {
    mockExecute.mockResolvedValue("awaiting_budget");
    const res = await POST(post({ tournament_id: TOURNAMENT_ID }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.outcome).toBe("awaiting_budget");
  });

  it("409s when a live automatic payout already exists, sending nothing", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const res = await POST(post({ tournament_id: TOURNAMENT_ID }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("PAYOUT_EXISTS");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("404s on an unknown tournament", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "tournament not found" },
    });
    expect((await POST(post({ tournament_id: TOURNAMENT_ID }))).status).toBe(404);
  });

  it.each([
    ["PAYOUT_BLOCKED: refund_pending", /refund has not settled/i],
    ["PAYOUT_RECIPIENT_INELIGIBLE: agreement_not_current", /Organizer Agreement/],
    ["PAYOUT_BELOW_MINIMUM: 500 cents is payable, the minimum is 1000", /minimum payout/i],
  ])("409s on %s, in words", async (message, expected) => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    const res = await POST(post({ tournament_id: TOURNAMENT_ID }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(expected);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("500s on any other database error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "serialization failure" },
    });
    expect((await POST(post({ tournament_id: TOURNAMENT_ID }))).status).toBe(500);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
