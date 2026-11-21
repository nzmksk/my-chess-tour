import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockFireRefund } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFireRefund: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));

vi.mock("@/services/refunds/fire", () => ({
  fireRefund: mockFireRefund,
}));

import { REFUND_SWEEP_GRACE_INTERVAL, sweepUnfiredRefunds } from "../sweep";

function refunds(n: number) {
  return Array.from({ length: n }, (_, i) => ({ refund_id: `rf-${i + 1}` }));
}

function listReturns(data: unknown, error: unknown = null) {
  mockRpc.mockResolvedValue({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();
  listReturns([]);
  mockFireRefund.mockResolvedValue("refunded");
});

describe("sweepUnfiredRefunds", () => {
  it("loads unfired refunds past the grace period, capped to a page", async () => {
    await sweepUnfiredRefunds();

    expect(mockRpc).toHaveBeenCalledWith("list_unfired_cancellation_refunds", {
      p_min_age: REFUND_SWEEP_GRACE_INTERVAL,
      p_limit: 100,
    });
  });

  it("fires every listed refund with the first-fire path and tallies the outcomes", async () => {
    listReturns(refunds(3));
    mockFireRefund
      .mockResolvedValueOnce("refunded")
      .mockResolvedValueOnce("processing")
      .mockResolvedValueOnce("refunded");

    const stats = await sweepUnfiredRefunds();

    expect(mockFireRefund.mock.calls).toEqual([["rf-1"], ["rf-2"], ["rf-3"]]);
    expect(stats).toEqual({
      fired: 3,
      outcomes: { refunded: 2, processing: 1 },
      more: false,
    });
  });

  it("keeps at most five CHIP refunds in flight at once", async () => {
    listReturns(refunds(12));
    let inFlight = 0;
    let peak = 0;
    mockFireRefund.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight -= 1;
      return "refunded";
    });

    const stats = await sweepUnfiredRefunds();

    expect(stats.fired).toBe(12);
    expect(peak).toBe(5);
  });

  it("stops starting batches once the budget is spent and says there is more", async () => {
    listReturns(refunds(12));
    let clock = 0;
    const now = () => clock;
    mockFireRefund.mockImplementation(async (id: string) => {
      if (["rf-1", "rf-6"].includes(id)) clock += 4_000;
      return "refunded";
    });

    const stats = await sweepUnfiredRefunds({ budgetMs: 6_000, now });

    expect(stats.fired).toBe(10);
    expect(stats.more).toBe(true);
    expect(mockFireRefund).not.toHaveBeenCalledWith("rf-11");
  });

  it("says there is more when the page came back full", async () => {
    listReturns(refunds(100));

    const stats = await sweepUnfiredRefunds({ budgetMs: Infinity });

    expect(stats.fired).toBe(100);
    expect(stats.more).toBe(true);
  });

  it("tallies failures and refusals without stopping", async () => {
    listReturns(refunds(3));
    mockFireRefund
      .mockResolvedValueOnce("error")
      .mockResolvedValueOnce("no_purchase")
      .mockResolvedValueOnce("refunded");

    const stats = await sweepUnfiredRefunds();

    expect(stats.outcomes).toEqual({ error: 1, no_purchase: 1, refunded: 1 });
    expect(stats.more).toBe(false);
  });

  it("does nothing when there is nothing to fire", async () => {
    listReturns(null);

    await expect(sweepUnfiredRefunds()).resolves.toEqual({
      fired: 0,
      outcomes: {},
      more: false,
    });
    expect(mockFireRefund).not.toHaveBeenCalled();
  });

  it("throws when the work list can't be loaded", async () => {
    listReturns(null, { message: "db down" });

    await expect(sweepUnfiredRefunds()).rejects.toThrow(/db down/);
    expect(mockFireRefund).not.toHaveBeenCalled();
  });
});
