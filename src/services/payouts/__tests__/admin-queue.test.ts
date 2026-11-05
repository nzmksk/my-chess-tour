import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockRpc, result } = vi.hoisted(() => {
  const result: { data: unknown; error: unknown } = { data: [], error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit"]) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = (onfulfilled: (v: unknown) => unknown) =>
    Promise.resolve(result).then(onfulfilled);
  return { result, mockFrom: vi.fn(() => builder), mockRpc: vi.fn() };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

import { loadAdminPayoutQueue } from "../admin-queue";

const rawPayout = {
  id: "p-1",
  kind: "automatic",
  status: "paid",
  approval: "approved",
  amount_cents: 10000,
  settled_amount_cents: 9500,
  failure_reason: null,
  chip_receipt_url: "https://chip.test/r/1",
  chip_send_limit_id: null,
  requested_at: "2026-10-01T00:00:00Z",
  processed_at: "2026-10-02T00:00:00Z",
  organization_id: "org-1",
  recipient_organization_id: "org-1",
  tournament: { id: "t-1", name: "KL Open" },
  organizer: { id: "org-1", name: "KL Chess" },
  recipient: { id: "org-1", name: "KL Chess" },
  bank: { bank_name: "Maybank", account_number: "514000001234", status: "verified" },
};

const rawCandidate = {
  tournament_id: "t-2",
  tournament_name: "Penang Open",
  end_date: "2026-11-01",
  organizing_organization: "Penang Chess",
  recipient_organization: "Penang Chess",
  is_beneficiary: false,
  available_cents: 5000,
  block_reason: null,
  recipient_problem: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  result.data = [rawPayout];
  result.error = null;
  mockRpc.mockResolvedValue({ data: [rawCandidate], error: null });
});

describe("loadAdminPayoutQueue", () => {
  it("never lets the full account number out", async () => {
    const { data } = await loadAdminPayoutQueue();
    expect(data?.payouts[0].bank).toEqual({
      name: "Maybank",
      account_last4: "1234",
      status: "verified",
    });
    expect(JSON.stringify(data)).not.toContain("514000001234");
  });

  it("shows what actually settled, not what was requested", async () => {
    const { data } = await loadAdminPayoutQueue();
    expect(data?.payouts[0].amount_cents).toBe(9500);
  });

  it("marks a beneficiary payout, so it stands out on the review screen", async () => {
    result.data = [{ ...rawPayout, recipient_organization_id: "org-2" }];
    const { data } = await loadAdminPayoutQueue();
    expect(data?.payouts[0].is_beneficiary).toBe(true);
  });

  it("flags a pending payout parked on a budget request", async () => {
    result.data = [{ ...rawPayout, status: "pending", chip_send_limit_id: 7 }];
    const { data } = await loadAdminPayoutQueue();
    expect(data?.payouts[0].awaiting_budget).toBe(true);
  });

  it("states a failure in words, not CHIP's raw response", async () => {
    result.data = [
      {
        ...rawPayout,
        status: "failed",
        failure_reason: 'chip_send_400: {"message":"raw detail"}',
      },
    ];
    const { data } = await loadAdminPayoutQueue();
    expect(data?.payouts[0].failure_reason).toBe("The transfer could not be completed.");
  });

  it("says why a candidate can't be paid, block before recipient", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { ...rawCandidate, block_reason: "refund_pending", recipient_problem: "agreement_not_current" },
        { ...rawCandidate, tournament_id: "t-3", recipient_problem: "agreement_not_current" },
        { ...rawCandidate, tournament_id: "t-4" },
      ],
      error: null,
    });
    const { data } = await loadAdminPayoutQueue();
    expect(data?.candidates[0].blocked).toMatch(/refund has not settled/i);
    expect(data?.candidates[1].blocked).toMatch(/Organizer Agreement/);
    expect(data?.candidates[2].blocked).toBeNull();
  });

  it("reports a failed load from either source", async () => {
    result.error = { message: "payouts down" };
    expect((await loadAdminPayoutQueue()).error).toBe("payouts down");

    result.error = null;
    mockRpc.mockResolvedValue({ data: null, error: { message: "rpc down" } });
    expect((await loadAdminPayoutQueue()).error).toBe("rpc down");
  });
});
