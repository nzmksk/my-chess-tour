import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, tables, mockProcessed, mockFailed } = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "single"]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) =>
      Promise.resolve(tables[table]?.shift() ?? { data: null, error: null }).then(
        onfulfilled,
        onrejected,
      );
    return b;
  }

  return {
    tables,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockRpc: vi.fn(),
    mockProcessed: vi.fn(),
    mockFailed: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

vi.mock("@/services/email/email", () => ({
  sendPayoutProcessedEmail: mockProcessed,
  sendPayoutFailedEmail: mockFailed,
}));

import { settlePayout } from "../settle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAYOUT_ID = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const BENEFICIARY = "33333333-3333-4333-8333-333333333333";

function queueEmailData(overrides: Record<string, unknown> = {}) {
  tables.payouts = [
    {
      data: {
        id: PAYOUT_ID,
        kind: "automatic",
        status: "paid",
        amount_cents: 10000,
        settled_amount_cents: 9000,
        failure_reason: null,
        chip_receipt_url: "https://chip.test/r/1",
        organization_id: ORG,
        recipient_organization_id: ORG,
        tournament: { name: "KL Open" },
        bank: { account_number: "514000001234" },
        ...overrides,
      },
      error: null,
    },
  ];
  tables.organization_memberships = [
    {
      data: [
        { user: { email: "owner@x.test", first_name: "Olu" }, roles: { name: "owner" } },
        { user: { email: "member@x.test", first_name: "Mei" }, roles: { name: "member" } },
      ],
      error: null,
    },
  ];
  tables.organizations = [
    { data: [{ name: "Org", email: "OWNER@x.test" }, { name: "Org", email: "club@x.test" }], error: null },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  mockRpc.mockResolvedValue({
    data: { already_processed: false, paid: true },
    error: null,
  });
  mockProcessed.mockResolvedValue(undefined);
  mockFailed.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("settlePayout", () => {
  it("passes every argument to the RPC", async () => {
    queueEmailData();
    await settlePayout({
      payoutId: PAYOUT_ID,
      chipSendInstructionId: 8,
      paid: true,
      amountCents: 9000,
      receiptUrl: "https://chip.test/r/1",
    });
    expect(mockRpc).toHaveBeenCalledWith("settle_payout", {
      p_payout_id: PAYOUT_ID,
      p_chip_send_instruction_id: 8,
      p_paid: true,
      p_amount_cents: 9000,
      p_receipt_url: "https://chip.test/r/1",
      p_failure_reason: null,
    });
  });

  it("emails owners/admins and the org address, deduped, once settled", async () => {
    queueEmailData();
    const res = await settlePayout({
      payoutId: PAYOUT_ID,
      chipSendInstructionId: 8,
      paid: true,
    });
    expect(res).toEqual({ error: null, settled: true });
    const to = mockProcessed.mock.calls.map((c) => c[0]);
    expect(to.sort()).toEqual(["club@x.test", "owner@x.test"]);
    expect(mockProcessed.mock.calls[0][1]).toMatchObject({
      tournamentName: "KL Open",
      amountCents: 9000,
      accountLast4: "1234",
      receiptUrl: "https://chip.test/r/1",
      early: false,
    });
  });

  it("never hands the full account number to the email", async () => {
    queueEmailData();
    await settlePayout({ payoutId: PAYOUT_ID, chipSendInstructionId: 8, paid: true });
    expect(JSON.stringify(mockProcessed.mock.calls)).not.toContain("514000001234");
  });

  it("notifies both sides when a beneficiary was paid", async () => {
    queueEmailData({ recipient_organization_id: BENEFICIARY });
    await settlePayout({ payoutId: PAYOUT_ID, chipSendInstructionId: 8, paid: true });
    const inCall = (mockFrom.mock.results.find(
      (_r, i) => mockFrom.mock.calls[i][0] === "organization_memberships",
    )?.value as { in: ReturnType<typeof vi.fn> }).in;
    expect(inCall).toHaveBeenCalledWith("organization_id", [ORG, BENEFICIARY]);
  });

  it("sends the failure email in plain language, not CHIP's raw message", async () => {
    mockRpc.mockResolvedValue({
      data: { already_processed: false, paid: false },
      error: null,
    });
    queueEmailData({ status: "failed", failure_reason: 'chip_send_400: {"message":"x"}' });
    await settlePayout({
      payoutId: PAYOUT_ID,
      chipSendInstructionId: null,
      paid: false,
      failureReason: 'chip_send_400: {"message":"x"}',
    });
    expect(mockProcessed).not.toHaveBeenCalled();
    expect(mockFailed.mock.calls[0][1].failureReason).toBe(
      "The transfer could not be completed.",
    );
  });

  it("stays quiet on a duplicate settle", async () => {
    mockRpc.mockResolvedValue({
      data: { already_processed: true, paid: true },
      error: null,
    });
    const res = await settlePayout({
      payoutId: PAYOUT_ID,
      chipSendInstructionId: 8,
      paid: true,
    });
    expect(res).toEqual({ error: null, settled: false });
    expect(mockProcessed).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs loudly on an over-payout, and still reports it settled", async () => {
    mockRpc.mockResolvedValue({
      data: { already_processed: false, paid: true, over_payout: true },
      error: null,
    });
    queueEmailData();
    const res = await settlePayout({
      payoutId: PAYOUT_ID,
      chipSendInstructionId: 8,
      paid: true,
    });
    expect(res.settled).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("more than was available"),
    );
  });

  it("logs loudly when CHIP completes a transfer we wrote off", async () => {
    mockRpc.mockResolvedValue({
      data: { already_processed: true, paid: false, paid_after_failed: true },
      error: null,
    });
    await settlePayout({ payoutId: PAYOUT_ID, chipSendInstructionId: 8, paid: true });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("already marked failed"),
    );
  });

  it("returns the RPC error for the caller to judge", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "serialization failure" },
    });
    const res = await settlePayout({
      payoutId: PAYOUT_ID,
      chipSendInstructionId: 8,
      paid: true,
    });
    expect(res).toEqual({
      error: { code: "40001", message: "serialization failure" },
      settled: false,
    });
  });

  it("does not let an email failure undo a settlement", async () => {
    queueEmailData();
    mockProcessed.mockRejectedValue(new Error("resend down"));
    const res = await settlePayout({
      payoutId: PAYOUT_ID,
      chipSendInstructionId: 8,
      paid: true,
    });
    expect(res).toEqual({ error: null, settled: true });
  });
});
