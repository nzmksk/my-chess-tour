import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  mockRefundsBuilder,
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
  const mockRefundsBuilder = makeBuilder({ data: null, error: null });
  const mockFrom = vi.fn((table: string) => {
    if (table === "registrations") return mockRegistrationsBuilder;
    if (table === "organization_memberships") return mockMembershipsBuilder;
    if (table === "organizations") return mockOrganizationsBuilder;
    if (table === "refunds") return mockRefundsBuilder;
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
    mockRefundsBuilder,
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

// Pending refunds returned by list_pending_cancellation_refunds; default none.
let pendingRefunds: unknown[] = [];
function setPendingRefunds(...refunds: unknown[]) {
  pendingRefunds = refunds;
}

// Dispatches supabaseAdmin.rpc by name so the review RPC, the refund list, and
// settle_refund each return sensible defaults. Individual tests can still call
// mockAdminRpc.mockResolvedValue(...) to force the review outcome (those cases
// short-circuit before the refund path runs).
function setAdminRpcDispatch(
  reviewResult: { data?: unknown; error?: unknown } = {
    data: { id: REQ_ID, tournament_id: TOUR_ID, status: "approved" },
    error: null,
  },
) {
  mockAdminRpc.mockImplementation((name: string) => {
    if (name === "list_pending_cancellation_refunds") {
      return Promise.resolve({ data: pendingRefunds, error: null });
    }
    if (name === "settle_refund") {
      return Promise.resolve({ data: { settled: true }, error: null });
    }
    return Promise.resolve(reviewResult);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  setAdmin();
  setPendingRefunds();
  setAdminRpcDispatch();
  mockRefundsBuilder.result = { data: null, error: null };
  // A completed refund is a Payment object — no `status` field. The in-flight
  // case returns a Purchase instead (see the pending_refund test below).
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

  it("emails every registered player on approval", async () => {
    await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });

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
    expect(mockSendCancellationEmail).not.toHaveBeenCalled();
  });

  // --- Review-outcome emails to the organization (owner/admin) --------------

  it("emails owner/admin members the approval outcome (not plain members)", async () => {
    await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });

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

    expect(mockSendReviewEmail).toHaveBeenCalledTimes(3);
    expect(mockSendReviewEmail).toHaveBeenCalledWith(
      "owner@example.com",
      expect.objectContaining({
        approved: false,
        rejectionReason: "Event is proceeding",
        tournamentName: "KL Open 2026",
      }),
    );
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
    expect(mockSendReviewEmail).toHaveBeenCalledTimes(2);
    expect(mockSendReviewEmail).toHaveBeenCalledWith(
      "owner@example.com",
      expect.anything(),
    );
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
    expect(mockSendReviewEmail).not.toHaveBeenCalled();
  });

  // --- Refund initiation on approval ---------------------------------------

  it("fires a full CHIP refund per pending refund and settles synchronous successes", async () => {
    setPendingRefunds(
      {
        refund_id: "rf-1",
        registration_id: "reg-1",
        amount_cents: 5500,
        original_chip_purchase_id: "chip-1",
      },
      {
        refund_id: "rf-2",
        registration_id: "reg-2",
        amount_cents: 4000,
        original_chip_purchase_id: "chip-2",
      },
    );

    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });

    expect(res.status).toBe(200);
    // Full refund → no amount argument.
    expect(mockRefundChipPurchase).toHaveBeenCalledTimes(2);
    expect(mockRefundChipPurchase).toHaveBeenCalledWith("chip-1");
    expect(mockRefundChipPurchase).toHaveBeenCalledWith("chip-2");
    expect(mockAdminRpc).toHaveBeenCalledWith("settle_refund", {
      p_refund_id: "rf-1",
      p_chip_refund_id: "refund-pay-1",
      p_paid: true,
      p_payment_method: null,
    });
    expect(mockAdminRpc).toHaveBeenCalledWith("settle_refund", {
      p_refund_id: "rf-2",
      p_chip_refund_id: "refund-pay-1",
      p_paid: true,
      p_payment_method: null,
    });
  });

  it("does not fire refunds on rejection", async () => {
    setPendingRefunds({
      refund_id: "rf-1",
      registration_id: "reg-1",
      amount_cents: 5500,
      original_chip_purchase_id: "chip-1",
    });
    setAdminRpcDispatch({
      data: { id: REQ_ID, tournament_id: TOUR_ID, status: "rejected" },
      error: null,
    });

    await PATCH(
      makeRequest({ action: "reject", rejection_reason: "Event is proceeding" }),
      { params: Promise.resolve({ id: REQ_ID }) },
    );

    expect(mockRefundChipPurchase).not.toHaveBeenCalled();
    expect(mockAdminRpc).not.toHaveBeenCalledWith(
      "settle_refund",
      expect.anything(),
    );
  });

  it("one player's CHIP failure doesn't block others or fail the request", async () => {
    setPendingRefunds(
      {
        refund_id: "rf-1",
        registration_id: "reg-1",
        amount_cents: 5500,
        original_chip_purchase_id: "chip-1",
      },
      {
        refund_id: "rf-2",
        registration_id: "reg-2",
        amount_cents: 4000,
        original_chip_purchase_id: "chip-2",
      },
    );
    mockRefundChipPurchase
      .mockRejectedValueOnce(new Error("CHIP down"))
      .mockResolvedValueOnce({ type: "payment", id: "refund-pay-2" });

    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });

    expect(res.status).toBe(200);
    // Only the successful one settles; the failed refund stays pending.
    expect(mockAdminRpc).toHaveBeenCalledWith("settle_refund", {
      p_refund_id: "rf-2",
      p_chip_refund_id: "refund-pay-2",
      p_paid: true,
      p_payment_method: null,
    });
    expect(mockAdminRpc).not.toHaveBeenCalledWith("settle_refund", {
      p_refund_id: "rf-1",
      p_chip_refund_id: expect.anything(),
      p_paid: true,
      p_payment_method: null,
    });
  });

  it("neither settles nor stamps an id when CHIP returns pending_refund", async () => {
    setPendingRefunds({
      refund_id: "rf-1",
      registration_id: "reg-1",
      amount_cents: 5500,
      original_chip_purchase_id: "chip-1",
    });
    // In-flight refunds come back as the *Purchase*, so `id` is the purchase id —
    // there is no refund Payment id yet. Writing it to chip_refund_id would put a
    // purchase id in a refund-id column; the payment.refunded webhook supplies
    // the real one.
    mockRefundChipPurchase.mockResolvedValue({
      id: "chip-1",
      status: "pending_refund",
    });

    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });

    expect(res.status).toBe(200);
    expect(mockRefundsBuilder.update).not.toHaveBeenCalled();
    expect(mockAdminRpc).not.toHaveBeenCalledWith(
      "settle_refund",
      expect.anything(),
    );
  });

  it("skips a refund whose registration payment has no CHIP purchase id", async () => {
    setPendingRefunds({
      refund_id: "rf-1",
      registration_id: "reg-1",
      amount_cents: 5500,
      original_chip_purchase_id: null,
    });

    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });

    expect(res.status).toBe(200);
    expect(mockRefundChipPurchase).not.toHaveBeenCalled();
  });

  it("still succeeds (200) when loading pending refunds fails", async () => {
    mockAdminRpc.mockImplementation((name: string) => {
      if (name === "list_pending_cancellation_refunds") {
        return Promise.resolve({ data: null, error: { message: "db down" } });
      }
      return Promise.resolve({
        data: { id: REQ_ID, tournament_id: TOUR_ID, status: "approved" },
        error: null,
      });
    });

    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });

    expect(res.status).toBe(200);
    expect(mockRefundChipPurchase).not.toHaveBeenCalled();
  });
});
