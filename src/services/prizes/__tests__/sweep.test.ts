import { beforeEach, describe, expect, it, vi } from "vitest";

const { results, filters, mockFrom, mockExecute, mockSettle, mockGetInstruction } = vi.hoisted(() => {
  const results: Array<{ data: unknown; error: unknown }> = [];
  const filters: Array<Record<string, unknown>> = [];
  function makeBuilder() {
    const f: Record<string, unknown> = {};
    filters.push(f);
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.order = vi.fn(() => b);
    for (const m of ["eq", "is", "lt"]) {
      b[m] = vi.fn((col: string, val: unknown) => {
        f[`${m}:${col}`] = val;
        return b;
      });
    }
    b.then = (onfulfilled: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
      Promise.resolve(results.shift() ?? { data: [], error: null }).then(onfulfilled, onrejected);
    return b;
  }
  return {
    results,
    filters,
    mockFrom: vi.fn(() => makeBuilder()),
    mockExecute: vi.fn(),
    mockSettle: vi.fn(),
    mockGetInstruction: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({ supabaseAdmin: { from: mockFrom } }));
vi.mock("../execute", () => ({ executePrizeAward: mockExecute }));
// PayoutPassError lives with the payout sweep; keep its email-sending neighbours out.
vi.mock("@/services/payouts/execute", () => ({ executePayout: vi.fn() }));
vi.mock("@/services/payouts/settle", () => ({ settlePayout: vi.fn() }));
vi.mock("../settle", () => ({ settlePrizeAward: mockSettle }));
vi.mock("@/services/chip/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/chip/send")>()),
  getChipSendInstruction: mockGetInstruction,
}));

import { reconcileStuckPrizeAwards, retryPendingPrizeAwards } from "../sweep";
import { PayoutPassError } from "@/services/payouts/sweep";

beforeEach(() => {
  vi.clearAllMocks();
  results.length = 0;
  filters.length = 0;
  mockExecute.mockResolvedValue("sent");
  mockSettle.mockResolvedValue({ error: null, settled: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reconcileStuckPrizeAwards", () => {
  it("settles from CHIP's record, and resumes a claim with no instruction", async () => {
    results.push({
      data: [
        { id: "a1", chip_send_instruction_id: 7001 },
        { id: "a2", chip_send_instruction_id: null },
      ],
      error: null,
    });
    mockGetInstruction.mockResolvedValue({ id: 7001, state: "completed", amount: "300.00", receipt_url: null });

    const stats = await reconcileStuckPrizeAwards(new Date("2026-11-18T00:00:00Z"));

    expect(filters[0]).toMatchObject({ "eq:status": "processing", "is:processed_at": null });
    expect(filters[0]["lt:updated_at"]).toBe("2026-11-17T00:00:00.000Z");
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ awardId: "a1", chipSendInstructionId: 7001, paid: true, amountCents: 30000 }),
    );
    expect(mockExecute).toHaveBeenCalledWith("a2");
    expect(stats).toMatchObject({ checked: 2, paid: 1, sent: 1 });
  });

  it("leaves an instruction CHIP is still working on", async () => {
    results.push({ data: [{ id: "a1", chip_send_instruction_id: 7001 }], error: null });
    mockGetInstruction.mockResolvedValue({ id: 7001, state: "accepted" });
    const stats = await reconcileStuckPrizeAwards();
    expect(mockSettle).not.toHaveBeenCalled();
    expect(stats.sent).toBe(1);
  });

  it("throws when it can't load its work", async () => {
    results.push({ data: null, error: { message: "down" } });
    await expect(reconcileStuckPrizeAwards()).rejects.toBeInstanceOf(PayoutPassError);
  });
});

describe("retryPendingPrizeAwards", () => {
  it("re-runs every approved, unsettled pending award", async () => {
    results.push({ data: [{ id: "a1" }, { id: "a2" }], error: null });
    mockExecute.mockResolvedValueOnce("paid").mockResolvedValueOnce("blocked");

    const stats = await retryPendingPrizeAwards();

    expect(filters[0]).toMatchObject({
      "eq:approval": "approved",
      "eq:status": "pending",
      "is:processed_at": null,
    });
    expect(stats).toMatchObject({ checked: 2, paid: 1, blocked: 1 });
  });

  it("counts a throw as an error and carries on", async () => {
    results.push({ data: [{ id: "a1" }, { id: "a2" }], error: null });
    mockExecute.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("sent");
    const stats = await retryPendingPrizeAwards();
    expect(stats).toMatchObject({ error: 1, sent: 1 });
  });
});
