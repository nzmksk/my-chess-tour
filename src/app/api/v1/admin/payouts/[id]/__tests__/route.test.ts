import { beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockGetClaims, mockRpc, mockAdminRpc, mockExecute, mockNotifyReviewed } =
  vi.hoisted(() => ({
    mockGetClaims: vi.fn(),
    mockRpc: vi.fn(),
    mockAdminRpc: vi.fn(),
    mockExecute: vi.fn(),
    mockNotifyReviewed: vi.fn(),
  }));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockAdminRpc },
}));

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
vi.mock("@/services/payouts/notify", () => ({
  notifyPayoutReviewed: mockNotifyReviewed,
}));

import { PATCH } from "../route";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PAYOUT_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TOUR_ID = "cccccccc-0000-0000-0000-000000000001";

function patch(body: unknown, id = PAYOUT_ID) {
  return PATCH(
    new NextRequest(`http://localhost/api/v1/admin/payouts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function setAdmin(isAdmin = true) {
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: ADMIN_USER_ID } },
    error: null,
  });
  mockRpc.mockResolvedValue({ data: isAdmin, error: null });
}

function reviewed(approval: "approved" | "rejected") {
  return {
    data: { id: PAYOUT_ID, tournament_id: TOUR_ID, amount_cents: 250000, approval },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAdmin();
  mockAdminRpc.mockResolvedValue(reviewed("approved"));
  mockExecute.mockResolvedValue("sent");
  mockNotifyReviewed.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PATCH /api/v1/admin/payouts/[id]: gate and validation", () => {
  it("400s on a malformed id, before anything else", async () => {
    const res = await patch({ action: "approve" }, "nope");
    expect(res.status).toBe(400);
    expect(mockGetClaims).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    expect((await patch({ action: "approve" })).status).toBe(401);
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  it("403s without platform.manage", async () => {
    setAdmin(false);
    expect((await patch({ action: "approve" })).status).toBe(403);
    expect(mockRpc).toHaveBeenCalledWith("has_global_permission", {
      p_user_id: appIdFor(ADMIN_USER_ID),
      p_permission: "platform.manage",
    });
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  it("500s when the permission check fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "rpc down" } });
    expect((await patch({ action: "approve" })).status).toBe(500);
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["an unknown action", { action: "maybe" }],
    ["no action", {}],
    ["a reject with no reason", { action: "reject" }],
    ["a reject with a blank reason", { action: "reject", rejection_reason: "  " }],
  ])("400s on %s", async (_label, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/admin/payouts/[id]", () => {
  it("approves, then sends the payout and reports how it went", async () => {
    const res = await patch({ action: "approve", rejection_reason: "ignored" });
    expect(res.status).toBe(200);
    expect(mockAdminRpc).toHaveBeenCalledWith("review_payout_request", {
      p_payout_id: PAYOUT_ID,
      p_reviewer_id: appIdFor(ADMIN_USER_ID),
      p_action: "approve",
      p_rejection_reason: null,
    });
    expect(mockExecute).toHaveBeenCalledWith(PAYOUT_ID);
    expect((await res.json()).data).toMatchObject({ approval: "approved", outcome: "sent" });
  });

  it("emails the organization before sending, so 'approved' lands first", async () => {
    await patch({ action: "approve" });
    expect(mockNotifyReviewed).toHaveBeenCalledWith(PAYOUT_ID);
    expect(mockNotifyReviewed.mock.invocationCallOrder[0]).toBeLessThan(
      mockExecute.mock.invocationCallOrder[0],
    );
  });

  it("still succeeds when the send is parked", async () => {
    mockExecute.mockResolvedValue("awaiting_budget");
    const res = await patch({ action: "approve" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.outcome).toBe("awaiting_budget");
  });

  it("rejects with a trimmed reason, sends nothing, and emails the organization", async () => {
    mockAdminRpc.mockResolvedValue(reviewed("rejected"));
    const res = await patch({ action: "reject", rejection_reason: "  Send the invoice  " });
    expect(res.status).toBe(200);
    expect(mockAdminRpc).toHaveBeenCalledWith(
      "review_payout_request",
      expect.objectContaining({ p_action: "reject", p_rejection_reason: "Send the invoice" }),
    );
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockNotifyReviewed).toHaveBeenCalledWith(PAYOUT_ID);
    expect((await res.json()).data.outcome).toBeUndefined();
  });

  it.each([
    ["P0002", "payout x not found", 404, /not found/i],
    ["P0001", "PAYOUT_ALREADY_REVIEWED: payout x already reviewed", 409, /already been reviewed/i],
    ["P0001", undefined, 409, /already been reviewed/i],
    ["P0001", "EARLY_PAYOUT_NOT_ALLOWED: cancellation_pending", 409, /cancellation request is under review/i],
    ["P0001", "EARLY_PAYOUT_NOT_ALLOWED: agreement_not_current", 409, /Organizer Agreement/],
    ["P0001", "EARLY_PAYOUT_EXCEEDS_CAP: 1500000 cents requested, 1000000 cents can be paid early", 409, /RM 15,000\.00.*RM 10,000\.00/],
    ["22023", "a rejection reason is required", 400, /rejection reason/],
    ["40001", "serialization failure", 500, /serialization/],
  ])("maps %s %s to %i", async (code, message, status, expected) => {
    mockAdminRpc.mockResolvedValue({ data: null, error: { code, message } });
    const res = await patch({ action: "approve" });
    expect(res.status).toBe(status);
    expect((await res.json()).error.message).toMatch(expected);
    // A refused review moves no money and tells nobody.
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockNotifyReviewed).not.toHaveBeenCalled();
  });
});
