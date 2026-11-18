import { describe, expect, it } from "vitest";
import { describePrizeAwardRefusal, prizeAwardStateLabel } from "../problems";

describe("describePrizeAwardRefusal", () => {
  it.each([
    ["PRIZE_AWARD_NOT_ALLOWED: pool_not_funded", "The prize pool isn't fully funded yet."],
    ["PRIZE_AWARD_NOT_ALLOWED: tournament_not_finished", "Winners can be entered from the last day of play."],
    ["PRIZE_AWARD_NOT_ALLOWED: something_new", "This prize award isn't allowed now."],
    [
      "PRIZE_AWARD_EXCEEDS_PRIZE: 1 cents requested, 0 cents of this prize is left",
      "Only RM 0.00 of this prize is left to award.",
    ],
    [
      "PRIZE_AWARD_EXCEEDS_POOL: 7500 cents requested, 5000 cents of the collected pool is uncommitted",
      "This award is RM 75.00, but only RM 50.00 of the collected pool is uncommitted.",
    ],
    ["PRIZE_AWARD_ALREADY_REVIEWED: prize award x already reviewed", "This award has already been reviewed."],
  ])("%s", (message, expected) => {
    expect(describePrizeAwardRefusal(message)).toBe(expected);
  });

  it("returns null for anything else", () => {
    expect(describePrizeAwardRefusal("relation does not exist")).toBeNull();
    expect(describePrizeAwardRefusal(null)).toBeNull();
  });
});

describe("prizeAwardStateLabel", () => {
  it.each([
    [{ approval: "pending", status: "pending" }, "Awaiting review"],
    [{ approval: "rejected", status: "pending" }, "Rejected"],
    [{ approval: "approved", status: "pending" }, "Approved"],
    [{ approval: "approved", status: "processing" }, "Sending"],
    [{ approval: "approved", status: "paid" }, "Paid"],
    [{ approval: "approved", status: "failed" }, "Failed"],
  ])("%o reads %s", (award, label) => {
    expect(prizeAwardStateLabel(award)).toBe(label);
  });
});
