import { describe, expect, it } from "vitest";
import { liveRefund, refundState } from "../state";

describe("refundState", () => {
  it("is processing until CHIP answers", () => {
    expect(refundState({ processed_at: null, failed_at: null })).toBe("processing");
  });

  it("is failed after a failure that nothing has cleared", () => {
    expect(
      refundState({ processed_at: null, failed_at: "2026-11-10T00:00:00Z" }),
    ).toBe("failed");
  });

  it("is refunded once settled, even after an earlier failure", () => {
    expect(
      refundState({
        processed_at: "2026-11-12T00:00:00Z",
        failed_at: "2026-11-10T00:00:00Z",
      }),
    ).toBe("refunded");
  });
});

describe("liveRefund", () => {
  it("skips rejected refunds", () => {
    const live = { id: "b", status: "pending" };
    expect(liveRefund([{ id: "a", status: "rejected" }, live])).toBe(live);
  });

  it("is null when there is none", () => {
    expect(liveRefund([])).toBeNull();
    expect(liveRefund(null)).toBeNull();
    expect(liveRefund([{ status: "rejected" }])).toBeNull();
  });
});
