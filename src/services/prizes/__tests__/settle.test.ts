import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockNotifyPaid } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockNotifyPaid: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => ({ supabaseAdmin: { rpc: mockRpc } }));
vi.mock("../notify", () => ({ notifyPrizePaid: mockNotifyPaid }));

import { runAfterCallbacks } from "@/test/after";
import { settlePrizeAward } from "../settle";

const input = {
  awardId: "award-1",
  chipSendInstructionId: 7001,
  paid: true,
  amountCents: 30000,
  receiptUrl: "https://r.test/1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("settlePrizeAward", () => {
  it("settles through settle_prize_award and emails the winner after the response", async () => {
    mockRpc.mockResolvedValue({ data: { already_processed: false }, error: null });

    const result = await settlePrizeAward(input);

    expect(result).toEqual({ error: null, settled: true });
    expect(mockRpc).toHaveBeenCalledWith("settle_prize_award", {
      p_award_id: "award-1",
      p_chip_send_instruction_id: 7001,
      p_paid: true,
      p_amount_cents: 30000,
      p_receipt_url: "https://r.test/1",
      p_failure_reason: null,
    });
    expect(mockNotifyPaid).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(mockNotifyPaid).toHaveBeenCalledWith("award-1");
  });

  it("is a quiet no-op for a repeat", async () => {
    mockRpc.mockResolvedValue({ data: { already_processed: true }, error: null });
    expect(await settlePrizeAward(input)).toEqual({ error: null, settled: false });
    await runAfterCallbacks();
    expect(mockNotifyPaid).not.toHaveBeenCalled();
  });

  it("emails nobody about a failure", async () => {
    mockRpc.mockResolvedValue({ data: { already_processed: false }, error: null });
    await settlePrizeAward({ ...input, paid: false, failureReason: "send_instruction_rejected" });
    await runAfterCallbacks();
    expect(mockNotifyPaid).not.toHaveBeenCalled();
  });

  it("logs an over-award and a paid-after-failed loudly", async () => {
    mockRpc.mockResolvedValue({ data: { already_processed: false, over_award: true }, error: null });
    await settlePrizeAward(input);
    mockRpc.mockResolvedValue({ data: { already_processed: true, paid_after_failed: true }, error: null });
    await settlePrizeAward(input);
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("reports an RPC failure for the caller to retry", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "08006", message: "down" } });
    expect(await settlePrizeAward(input)).toEqual({
      error: { code: "08006", message: "down" },
      settled: false,
    });
  });
});
