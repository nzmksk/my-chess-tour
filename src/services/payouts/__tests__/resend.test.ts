import { describe, expect, it } from "vitest";
import { canResend } from "../resend";

const base = {
  approval: "approved",
  status: "pending",
  processed_at: null,
  chip_send_instruction_id: null,
};

describe("canResend", () => {
  it("offers a re-send of an approved payout that hasn't gone out", () => {
    expect(canResend(base)).toBe(true);
  });

  it("offers one for a claimed send that never recorded an instruction", () => {
    expect(canResend({ ...base, status: "processing" })).toBe(true);
  });

  it.each([
    ["awaiting review", { approval: "pending" }],
    ["rejected", { approval: "rejected" }],
    ["out with CHIP", { status: "processing", chip_send_instruction_id: 8 }],
    ["paid", { status: "paid", processed_at: "2026-11-01T00:00:00Z" }],
    ["failed", { status: "failed", processed_at: "2026-11-01T00:00:00Z" }],
  ])("offers nothing for a payout that is %s", (_label, overrides) => {
    expect(canResend({ ...base, ...overrides })).toBe(false);
  });
});
