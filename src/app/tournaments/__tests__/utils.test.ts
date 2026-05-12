import { describe, expect, it } from "vitest";
import { formatRm, toTitleCase, formatDeadline, calculateAge } from "../utils";

describe("formatRm", () => {
  it("returns 'Free' for 0 cents", () => {
    expect(formatRm(0)).toBe("Free");
  });

  it("formats whole RM amounts correctly", () => {
    expect(formatRm(3000)).toBe("RM30");
    expect(formatRm(2400)).toBe("RM24");
    expect(formatRm(1800)).toBe("RM18");
  });

  it("formats RM1 from 100 cents", () => {
    expect(formatRm(100)).toBe("RM1");
  });

  it("formats thousands with a thousands separator", () => {
    const result = formatRm(100000);
    expect(result).toMatch(/^RM1.000$/);
  });

  it("rounds to whole RM (no decimal places)", () => {
    const result = formatRm(5050);
    expect(result).not.toContain(".");
  });
});

describe("toTitleCase", () => {
  it("capitalises a single lowercase word", () => {
    expect(toTitleCase("standard")).toBe("Standard");
  });

  it("replaces underscores with spaces and capitalises each word", () => {
    expect(toTitleCase("early_bird")).toBe("Early Bird");
  });

  it("handles multiple underscore-separated words", () => {
    expect(toTitleCase("women_only_fee")).toBe("Women Only Fee");
  });

  it("treats spaces as word separators", () => {
    expect(toTitleCase("age based")).toBe("Age Based");
  });

  it("handles mixed underscores and spaces", () => {
    expect(toTitleCase("age_based fee")).toBe("Age Based Fee");
  });

  it("leaves an already-capitalised word unchanged", () => {
    expect(toTitleCase("Standard")).toBe("Standard");
  });

  it("handles consecutive separators", () => {
    expect(toTitleCase("a__b")).toBe("A B");
  });
});

describe("calculateAge", () => {
  it("returns correct age well before birthday", () => {
    const dob = new Date("2000-12-31");
    const now = new Date("2026-01-01");
    expect(calculateAge(dob, now)).toBe(25);
  });

  it("returns correct age well after birthday", () => {
    const dob = new Date("2000-01-01");
    const now = new Date("2026-06-01");
    expect(calculateAge(dob, now)).toBe(26);
  });

  it("counts the birthday itself as having turned the new age", () => {
    const dob = new Date("2008-05-12");
    const now = new Date("2026-05-12");
    expect(calculateAge(dob, now)).toBe(18);
  });

  it("returns one year less the day before birthday", () => {
    const dob = new Date("2008-05-13");
    const now = new Date("2026-05-12");
    expect(calculateAge(dob, now)).toBe(17);
  });
});

describe("formatDeadline", () => {
  it("returns a non-empty string", () => {
    expect(formatDeadline("2025-12-15T12:00:00.000Z")).toBeTruthy();
  });

  it("includes the year in the output", () => {
    expect(formatDeadline("2025-12-15T12:00:00.000Z")).toContain("2025");
  });

  it("includes a recognisable month abbreviation for January", () => {
    expect(formatDeadline("2026-01-15T12:00:00.000Z")).toMatch(/Jan/);
  });

  it("includes a recognisable month abbreviation for June", () => {
    expect(formatDeadline("2026-06-15T12:00:00.000Z")).toMatch(/Jun/);
  });

  it("includes the day number in the output", () => {
    expect(formatDeadline("2026-03-20T12:00:00.000Z")).toContain("20");
  });
});
