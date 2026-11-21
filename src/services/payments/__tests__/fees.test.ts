import { describe, expect, it } from "vitest";
import { computeEntryFeeBreakdown } from "../fees";

describe("computeEntryFeeBreakdown", () => {
  it("matches the SQL default case (RM36, 10%, organizer absorbs 0)", () => {
    expect(computeEntryFeeBreakdown(3600, 10, 0)).toEqual({
      entry_cents: 3600,
      processing_fee_cents: 360,
      gross_cents: 3960,
    });
  });

  it("splits the commission when the organizer absorbs part of it", () => {
    expect(computeEntryFeeBreakdown(3600, 10, 5)).toEqual({
      entry_cents: 3600,
      processing_fee_cents: 180,
      gross_cents: 3780,
    });
  });

  it("charges nothing extra when the organizer absorbs all commission", () => {
    expect(computeEntryFeeBreakdown(3600, 10, 10)).toEqual({
      entry_cents: 3600,
      processing_fee_cents: 0,
      gross_cents: 3600,
    });
  });

  it("returns zeros for a free tier", () => {
    expect(computeEntryFeeBreakdown(0, 10, 0)).toEqual({
      entry_cents: 0,
      processing_fee_cents: 0,
      gross_cents: 0,
    });
  });

  it("floors the platform fee (no rounding up of fractional sen)", () => {
    expect(computeEntryFeeBreakdown(3550, 10, 0).processing_fee_cents).toBe(
      355,
    );
    expect(computeEntryFeeBreakdown(3555, 10, 0).processing_fee_cents).toBe(
      355,
    );
  });
});
