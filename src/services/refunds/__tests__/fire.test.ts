import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockRefundChipPurchase, mockNotify } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockRefundChipPurchase: vi.fn(),
  mockNotify: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));

// Keep the real refund outcome mapper; only stub the network calls.
vi.mock("@/services/chip/chip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/chip/chip")>();
  return { ...actual, refundChipPurchase: mockRefundChipPurchase };
});

vi.mock("@/services/refunds/notify", () => ({
  notifyRefundSettlement: mockNotify,
}));

import {
  fireRefund,
  initiateCancellationRefunds,
  REFUND_STUCK_AFTER_INTERVAL,
} from "../fire";

const SETTLED = { settled: true, newly_settled: true, newly_failed: false };

type RpcResult = { data?: unknown; error?: unknown };
let claimResult: RpcResult;
let settleResult: RpcResult;
let pendingRefunds: RpcResult;

beforeEach(() => {
  vi.clearAllMocks();
  claimResult = {
    data: { claimed: true, original_chip_purchase_id: "purchase-1" },
    error: null,
  };
  settleResult = { data: SETTLED, error: null };
  pendingRefunds = { data: [], error: null };
  mockRpc.mockImplementation((name: string) => {
    if (name === "claim_refund_fire") return Promise.resolve(claimResult);
    if (name === "settle_refund") return Promise.resolve(settleResult);
    if (name === "list_pending_cancellation_refunds") {
      return Promise.resolve(pendingRefunds);
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  // A completed refund is a Payment object, with no `status`.
  mockRefundChipPurchase.mockResolvedValue({ type: "payment", id: "refund-pay-1" });
});

describe("fireRefund", () => {
  it("claims the refund with the stuck threshold before calling CHIP", async () => {
    await fireRefund("rf-1");

    expect(mockRpc).toHaveBeenCalledWith("claim_refund_fire", {
      p_refund_id: "rf-1",
      p_min_age: REFUND_STUCK_AFTER_INTERVAL,
    });
    expect(mockRpc.mock.invocationCallOrder[0]).toBeLessThan(
      mockRefundChipPurchase.mock.invocationCallOrder[0],
    );
  });

  it("refunds the purchase the claim hands back, settles it and notifies", async () => {
    await expect(fireRefund("rf-1")).resolves.toBe("refunded");

    expect(mockRefundChipPurchase).toHaveBeenCalledWith("purchase-1");
    expect(mockRpc).toHaveBeenCalledWith("settle_refund", {
      p_refund_id: "rf-1",
      p_chip_refund_id: "refund-pay-1",
      p_paid: true,
      p_payment_method: null,
    });
    expect(mockNotify).toHaveBeenCalledWith("rf-1", SETTLED);
  });

  it.each(["settled", "rejected", "in_flight", "no_purchase", "not_found"])(
    "never calls CHIP when the claim refuses (%s)",
    async (reason) => {
      claimResult = { data: { claimed: false, reason }, error: null };

      await expect(fireRefund("rf-1")).resolves.toBe(reason);
      expect(mockRefundChipPurchase).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalledWith("settle_refund", expect.anything());
    },
  );

  it("never calls CHIP when the claim itself errors", async () => {
    claimResult = { data: null, error: { message: "db down" } };

    await expect(fireRefund("rf-1")).resolves.toBe("error");
    expect(mockRefundChipPurchase).not.toHaveBeenCalled();
  });

  it("leaves the refund pending when CHIP throws", async () => {
    mockRefundChipPurchase.mockRejectedValue(new Error("CHIP API error 503"));

    await expect(fireRefund("rf-1")).resolves.toBe("error");
    expect(mockRpc).not.toHaveBeenCalledWith("settle_refund", expect.anything());
  });

  it("records nothing when CHIP answers pending_refund", async () => {
    mockRefundChipPurchase.mockResolvedValue({ id: "purchase-1", status: "pending_refund" });

    await expect(fireRefund("rf-1")).resolves.toBe("processing");
    expect(mockRpc).not.toHaveBeenCalledWith("settle_refund", expect.anything());
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("reports an error and sends nothing when settle_refund fails", async () => {
    settleResult = { data: null, error: { message: "db down" } };

    await expect(fireRefund("rf-1")).resolves.toBe("error");
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("initiateCancellationRefunds", () => {
  it("fires every pending refund of the tournament", async () => {
    pendingRefunds = {
      data: [{ refund_id: "rf-1" }, { refund_id: "rf-2" }, { refund_id: "rf-3" }],
      error: null,
    };

    await initiateCancellationRefunds("t-1");

    expect(mockRpc).toHaveBeenCalledWith("list_pending_cancellation_refunds", {
      p_tournament_id: "t-1",
    });
    const claimed = mockRpc.mock.calls
      .filter(([name]) => name === "claim_refund_fire")
      .map(([, args]) => (args as { p_refund_id: string }).p_refund_id);
    expect(claimed).toEqual(["rf-1", "rf-2", "rf-3"]);
  });

  it("keeps going when one refund's CHIP call fails", async () => {
    pendingRefunds = { data: [{ refund_id: "rf-1" }, { refund_id: "rf-2" }], error: null };
    mockRefundChipPurchase
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ type: "payment", id: "refund-pay-2" });

    await initiateCancellationRefunds("t-1");

    expect(mockRefundChipPurchase).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith(
      "settle_refund",
      expect.objectContaining({ p_chip_refund_id: "refund-pay-2" }),
    );
  });

  it("does nothing when the pending refunds can't be loaded", async () => {
    pendingRefunds = { data: null, error: { message: "db down" } };

    await initiateCancellationRefunds("t-1");

    expect(mockRpc).not.toHaveBeenCalledWith("claim_refund_fire", expect.anything());
  });
});
