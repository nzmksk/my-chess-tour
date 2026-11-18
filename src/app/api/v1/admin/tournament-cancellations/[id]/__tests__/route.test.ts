import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAfterCallbacks } from "@/test/after";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockTournamentBuilder,
  mockRegistrationsBuilder,
  mockMembershipsBuilder,
  mockOrganizationsBuilder,
  mockFrom,
  mockGetClaims,
  mockRpc,
  mockAdminRpc,
  mockSendCancellationEmail,
  mockSendReviewEmail,
  mockRefundChipPurchase,
} = vi.hoisted(() => {
  function makeBuilder(finalResult: { data?: unknown; error?: unknown }) {
    const b: Record<string, unknown> = { result: finalResult };
    for (const m of ["select", "eq", "in", "single", "update"]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) => Promise.resolve(b.result).then(onfulfilled, onrejected);
    return b;
  }

  const mockTournamentBuilder = makeBuilder({ data: null, error: null });
  const mockRegistrationsBuilder = makeBuilder({ data: [], error: null });
  const mockMembershipsBuilder = makeBuilder({ data: [], error: null });
  const mockOrganizationsBuilder = makeBuilder({ data: null, error: null });
  const mockFrom = vi.fn((table: string) => {
    if (table === "registrations") return mockRegistrationsBuilder;
    if (table === "organization_memberships") return mockMembershipsBuilder;
    if (table === "organizations") return mockOrganizationsBuilder;
    return mockTournamentBuilder;
  });
  const mockGetClaims = vi.fn();
  const mockRpc = vi.fn();
  const mockAdminRpc = vi.fn();
  const mockSendCancellationEmail = vi.fn();
  const mockSendReviewEmail = vi.fn();
  const mockRefundChipPurchase = vi.fn();

  return {
    mockTournamentBuilder,
    mockRegistrationsBuilder,
    mockMembershipsBuilder,
    mockOrganizationsBuilder,
    mockFrom,
    mockGetClaims,
    mockRpc,
    mockAdminRpc,
    mockSendCancellationEmail,
    mockSendReviewEmail,
    mockRefundChipPurchase,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockAdminRpc },
}));

// Keep the real refund outcome/event mappers; only stub the network call.
vi.mock("@/services/chip/chip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/chip/chip")>();
  return { ...actual, refundChipPurchase: mockRefundChipPurchase };
});

vi.mock("@/services/email/email", () => ({
  sendTournamentCancellationEmail: mockSendCancellationEmail,
  sendCancellationReviewEmail: mockSendReviewEmail,
}));

const { mockNotifyRefund } = vi.hoisted(() => ({ mockNotifyRefund: vi.fn() }));
vi.mock("@/services/refunds/notify", () => ({
  notifyRefundSettlement: mockNotifyRefund,
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

const { mockSyncFunding } = vi.hoisted(() => ({ mockSyncFunding: vi.fn() }));
vi.mock("@/services/prizes/funding-requests", () => ({
  syncPrizeFundingRequests: mockSyncFunding,
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { PATCH } from "../route";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const REQ_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TOUR_ID = "cccccccc-0000-0000-0000-000000000001";
const ORG_ID = "dddddddd-0000-0000-0000-000000000001";

function makeRequest(body: unknown, id = REQ_ID): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/admin/tournament-cancellations/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function setAdmin(isAdmin = true) {
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: ADMIN_USER_ID } },
    error: null,
  });
  mockRpc.mockResolvedValue({ data: isAdmin, error: null });
}

function setNoUser() {
  mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
}

// Dispatches supabaseAdmin.rpc. The route's only RPC is the review itself;
// individual tests can still call mockAdminRpc.mockResolvedValue(...) to force
// its outcome.
function setAdminRpcDispatch(
  reviewResult: { data?: unknown; error?: unknown } = {
    data: { id: REQ_ID, tournament_id: TOUR_ID, status: "approved" },
    error: null,
  },
) {
  mockAdminRpc.mockImplementation(() => Promise.resolve(reviewResult));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  setAdmin();
  setAdminRpcDispatch();
  mockSyncFunding.mockResolvedValue({
    error: null,
    released: false,
    linked: 0,
    unlinked: 0,
    missingContacts: [],
  });
  // Would refund on the spot, if anything called it: the route must not.
  mockRefundChipPurchase.mockResolvedValue({
    type: "payment",
    id: "refund-pay-1",
  });
  mockTournamentBuilder.result = {
    data: {
      slug: "kl-open-2026",
      name: "KL Open 2026",
      organization_id: ORG_ID,
    },
    error: null,
  };
  mockRegistrationsBuilder.result = {
    data: [
      { user: { email: "ali@example.com", first_name: "Ali" } },
      { user: { email: "siti@example.com", first_name: "Siti" } },
    ],
    error: null,
  };
  mockMembershipsBuilder.result = {
    data: [
      {
        user: { email: "owner@example.com", first_name: "Olivia" },
        roles: { name: "owner" },
      },
      {
        user: { email: "admin@example.com", first_name: "Adam" },
        roles: { name: "admin" },
      },
      {
        user: { email: "member@example.com", first_name: "Max" },
        roles: { name: "member" },
      },
    ],
    error: null,
  };
  mockOrganizationsBuilder.result = {
    data: { name: "KL Chess Club", email: "contact@klchess.org" },
    error: null,
  };
  mockSendCancellationEmail.mockResolvedValue(undefined);
  mockSendReviewEmail.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/v1/admin/tournament-cancellations/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    setNoUser();
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin", async () => {
    setAdmin(false);
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid action", async () => {
    const res = await PATCH(makeRequest({ action: "maybe" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when rejecting without a reason", async () => {
    const res = await PATCH(makeRequest({ action: "reject" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("approves a request and calls the review RPC", async () => {
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockAdminRpc).toHaveBeenCalledWith(
      "review_tournament_cancellation",
      expect.objectContaining({
        p_request_id: REQ_ID,
        p_reviewer_id: appIdFor(ADMIN_USER_ID),
        p_action: "approve",
        p_rejection_reason: null,
      }),
    );
  });

  it("withdraws the sponsors' payment links when it approves", async () => {
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockSyncFunding).toHaveBeenCalledWith(TOUR_ID, null);
  });

  it("rejects a request with a reason", async () => {
    mockAdminRpc.mockResolvedValue({
      data: { id: REQ_ID, tournament_id: TOUR_ID, status: "rejected" },
      error: null,
    });
    const res = await PATCH(
      makeRequest({ action: "reject", rejection_reason: "Event is proceeding" }),
      { params: Promise.resolve({ id: REQ_ID }) },
    );
    expect(res.status).toBe(200);
    expect(mockAdminRpc).toHaveBeenCalledWith(
      "review_tournament_cancellation",
      expect.objectContaining({
        p_action: "reject",
        p_rejection_reason: "Event is proceeding",
      }),
    );
  });

  it("returns 404 when the request is not found (P0002)", async () => {
    mockAdminRpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the request was already reviewed (P0001)", async () => {
    mockAdminRpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 409 with the shortfall when a payout has already been paid", async () => {
    mockAdminRpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message:
          "CANCELLATION_BLOCKED_BY_PAYOUT: 400000 cents paid out, 250050 cents short of the refunds",
      },
    });
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("PAYOUT_ALREADY_SENT");
    expect(body.error.message).toContain("RM 4,000.00 has already been paid out");
    expect(body.error.message).toContain("RM 2,500.50 short");
    // Nothing downstream runs for a refused approval.
    expect(mockRefundChipPurchase).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(mockSendCancellationEmail).not.toHaveBeenCalled();
    expect(mockSendReviewEmail).not.toHaveBeenCalled();
  });

  it("returns 409 when a payout is still being sent", async () => {
    mockAdminRpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "CANCELLATION_BLOCKED_BY_PAYOUT: a payout is being sent",
      },
    });
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("PAYOUT_ALREADY_SENT");
    expect(body.error.message).toContain("being sent");
  });

  it("emails every registered player on approval", async () => {
    await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    // Nothing is sent until the response has gone out.
    expect(mockSendCancellationEmail).not.toHaveBeenCalled();
    await runAfterCallbacks();

    expect(mockFrom).toHaveBeenCalledWith("registrations");
    expect(mockRegistrationsBuilder.in).toHaveBeenCalledWith("status", [
      "confirmed",
      "pending_payment",
    ]);
    expect(mockSendCancellationEmail).toHaveBeenCalledTimes(2);
    expect(mockSendCancellationEmail).toHaveBeenCalledWith("ali@example.com", {
      playerName: "Ali",
      tournamentName: "KL Open 2026",
    });
    expect(mockSendCancellationEmail).toHaveBeenCalledWith("siti@example.com", {
      playerName: "Siti",
      tournamentName: "KL Open 2026",
    });
  });

  it("does not email players when the request is rejected", async () => {
    mockAdminRpc.mockResolvedValue({
      data: { id: REQ_ID, tournament_id: TOUR_ID, status: "rejected" },
      error: null,
    });
    await PATCH(
      makeRequest({ action: "reject", rejection_reason: "Event is proceeding" }),
      { params: Promise.resolve({ id: REQ_ID }) },
    );

    await runAfterCallbacks();
    expect(mockSendCancellationEmail).not.toHaveBeenCalled();
  });

  it("skips registrations with no linked user or email", async () => {
    mockRegistrationsBuilder.result = {
      data: [
        { user: { email: "ali@example.com", first_name: "Ali" } },
        { user: null },
        { user: { email: null, first_name: "Ghost" } },
      ],
      error: null,
    };
    await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });

    await runAfterCallbacks();
    expect(mockSendCancellationEmail).toHaveBeenCalledTimes(1);
    expect(mockSendCancellationEmail).toHaveBeenCalledWith(
      "ali@example.com",
      expect.anything(),
    );
  });

  it("still succeeds (200) when sending an email fails", async () => {
    mockSendCancellationEmail.mockRejectedValueOnce(new Error("Resend down"));
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(200);
  });

  it("still succeeds (200) when loading registrations fails", async () => {
    mockRegistrationsBuilder.result = {
      data: null,
      error: { message: "db down" },
    };
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(200);
    await runAfterCallbacks();
    expect(mockSendCancellationEmail).not.toHaveBeenCalled();
  });

  // --- Review-outcome emails to the organization (owner/admin) --------------

  it("emails owner/admin members the approval outcome (not plain members)", async () => {
    await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    await runAfterCallbacks();

    expect(mockFrom).toHaveBeenCalledWith("organization_memberships");
    expect(mockMembershipsBuilder.eq).toHaveBeenCalledWith(
      "organization_id",
      ORG_ID,
    );
    expect(mockSendReviewEmail).toHaveBeenCalledTimes(3);
    expect(mockSendReviewEmail).toHaveBeenCalledWith(
      "owner@example.com",
      expect.objectContaining({
        recipientName: "Olivia",
        tournamentName: "KL Open 2026",
        approved: true,
      }),
    );
    expect(mockSendReviewEmail).toHaveBeenCalledWith(
      "admin@example.com",
      expect.objectContaining({ recipientName: "Adam", approved: true }),
    );
    expect(mockSendReviewEmail).not.toHaveBeenCalledWith(
      "member@example.com",
      expect.anything(),
    );
  });

  it("also emails the organization's own contact email", async () => {
    await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    await runAfterCallbacks();

    expect(mockFrom).toHaveBeenCalledWith("organizations");
    expect(mockOrganizationsBuilder.eq).toHaveBeenCalledWith("id", ORG_ID);
    expect(mockSendReviewEmail).toHaveBeenCalledWith(
      "contact@klchess.org",
      expect.objectContaining({
        recipientName: "KL Chess Club",
        tournamentName: "KL Open 2026",
        approved: true,
      }),
    );
  });

  it("does not duplicate when the org email matches a member's email", async () => {
    mockOrganizationsBuilder.result = {
      data: { name: "KL Chess Club", email: "OWNER@example.com" },
      error: null,
    };
    await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });

    // owner + admin only — the org email collides with the owner (case-insensitively).
    await runAfterCallbacks();
    expect(mockSendReviewEmail).toHaveBeenCalledTimes(2);
    expect(mockSendReviewEmail).not.toHaveBeenCalledWith(
      "OWNER@example.com",
      expect.anything(),
    );
  });

  it("still notifies members when the org has no contact email", async () => {
    mockOrganizationsBuilder.result = {
      data: { name: "KL Chess Club", email: null },
      error: null,
    };
    await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });

    await runAfterCallbacks();
    expect(mockSendReviewEmail).toHaveBeenCalledTimes(2);
  });

  it("emails owner/admin members the rejection outcome with the reason", async () => {
    mockAdminRpc.mockResolvedValue({
      data: { id: REQ_ID, tournament_id: TOUR_ID, status: "rejected" },
      error: null,
    });
    await PATCH(
      makeRequest({ action: "reject", rejection_reason: "Event is proceeding" }),
      { params: Promise.resolve({ id: REQ_ID }) },
    );

    await runAfterCallbacks();
    expect(mockSendReviewEmail).toHaveBeenCalledTimes(3);
    expect(mockSendReviewEmail).toHaveBeenCalledWith(
      "owner@example.com",
      expect.objectContaining({
        approved: false,
        rejectionReason: "Event is proceeding",
        tournamentName: "KL Open 2026",
      }),
    );
    await runAfterCallbacks();
    expect(mockSendReviewEmail).toHaveBeenCalledWith(
      "contact@klchess.org",
      expect.objectContaining({
        approved: false,
        rejectionReason: "Event is proceeding",
      }),
    );
  });

  it("skips members with no linked user or email", async () => {
    mockMembershipsBuilder.result = {
      data: [
        {
          user: { email: "owner@example.com", first_name: "Olivia" },
          roles: { name: "owner" },
        },
        { user: null, roles: { name: "admin" } },
        { user: { email: null, first_name: "Ghost" }, roles: { name: "admin" } },
      ],
      error: null,
    };
    await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });

    // owner (valid member) + org contact email.
    await runAfterCallbacks();
    expect(mockSendReviewEmail).toHaveBeenCalledTimes(2);
    expect(mockSendReviewEmail).toHaveBeenCalledWith(
      "owner@example.com",
      expect.anything(),
    );
    await runAfterCallbacks();
    expect(mockSendReviewEmail).toHaveBeenCalledWith(
      "contact@klchess.org",
      expect.anything(),
    );
  });

  it("still succeeds (200) when a review email fails", async () => {
    mockSendReviewEmail.mockRejectedValueOnce(new Error("Resend down"));
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(200);
  });

  it("still succeeds (200) when loading members fails", async () => {
    mockMembershipsBuilder.result = {
      data: null,
      error: { message: "db down" },
    };
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(200);
    await runAfterCallbacks();
    expect(mockSendReviewEmail).not.toHaveBeenCalled();
  });

  // --- Refunds are left to the sweep (#496) --------------------------------

  it("queues refunds through the review RPC but sends none to CHIP", async () => {
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    await runAfterCallbacks();

    expect(res.status).toBe(200);
    // review_tournament_cancellation queues them; the refund sweep fires them.
    expect(mockAdminRpc.mock.calls.map(([name]) => name)).toEqual([
      "review_tournament_cancellation",
    ]);
    expect(mockRefundChipPurchase).not.toHaveBeenCalled();
    expect(mockNotifyRefund).not.toHaveBeenCalled();
  });
});
