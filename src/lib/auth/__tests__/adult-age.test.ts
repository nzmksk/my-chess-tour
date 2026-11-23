import { describe, expect, it } from "vitest";
import { isUnderAdultAge } from "../adult-age";

describe("isUnderAdultAge", () => {
  it("is under 18 the day before the 18th birthday and not on it", () => {
    expect(isUnderAdultAge("2008-11-25", "2026-11-24")).toBe(true);
    expect(isUnderAdultAge("2008-11-24", "2026-11-24")).toBe(false);
    expect(isUnderAdultAge("1990-01-01", "2026-11-24")).toBe(false);
  });

  it("treats a 29 February birthday as reaching 18 on 1 March in a common year", () => {
    expect(isUnderAdultAge("2008-02-29", "2026-02-28")).toBe(true);
    expect(isUnderAdultAge("2008-02-29", "2026-03-01")).toBe(false);
  });

  it("handles today being 29 February", () => {
    expect(isUnderAdultAge("2010-02-28", "2028-02-29")).toBe(false);
    expect(isUnderAdultAge("2010-03-01", "2028-02-29")).toBe(true);
  });

  it("defaults today to the date in Malaysia", () => {
    expect(isUnderAdultAge("2000-01-01")).toBe(false);
    expect(isUnderAdultAge("2999-01-01")).toBe(true);
  });
});
