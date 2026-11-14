import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  addCalendarDays,
  endOfMonth,
  formatCalendarDate,
  formatCalendarDateRange,
  formatInstantDate,
  getTodayInTimeZone,
  isSupportedTimeZone,
  resolveTimeZone,
  startOfMonth,
  timeZoneAbbreviation,
  toCalendarDateInTimeZone,
  toInstantInTimeZone,
  toLocalDateTimeInput,
  utcOffsetInTimeZone,
} from "../datetime";

describe("getTodayInTimeZone", () => {
  it("rolls to the next day for an instant past midnight in Malaysia (UTC+8)", () => {
    // 2026-03-09 17:00 UTC = 2026-03-10 01:00 in Kuala Lumpur
    expect(
      getTodayInTimeZone("Asia/Kuala_Lumpur", new Date("2026-03-09T17:00:00Z")),
    ).toBe("2026-03-10");
  });

  it("stays on the same day for an instant still before midnight in Malaysia", () => {
    // 2026-03-09 15:00 UTC = 2026-03-09 23:00 in Kuala Lumpur
    expect(
      getTodayInTimeZone("Asia/Kuala_Lumpur", new Date("2026-03-09T15:00:00Z")),
    ).toBe("2026-03-09");
  });

  it("gives different days to venues in different zones at the same instant", () => {
    const instant = new Date("2026-03-09T17:00:00Z");
    // Already the 10th in Manila (UTC+8), still the 9th in Yangon (UTC+6:30).
    expect(getTodayInTimeZone("Asia/Manila", instant)).toBe("2026-03-10");
    expect(getTodayInTimeZone("Asia/Yangon", instant)).toBe("2026-03-09");
  });

  it("returns an ISO YYYY-MM-DD string", () => {
    expect(getTodayInTimeZone()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("resolveTimeZone", () => {
  it("keeps a supported venue timezone", () => {
    expect(resolveTimeZone("Asia/Bangkok")).toBe("Asia/Bangkok");
  });

  it("falls back to the platform default for a missing or unknown zone", () => {
    expect(resolveTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("")).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe(DEFAULT_TIME_ZONE);
  });

  it("recognises only zones on the venue picklist", () => {
    expect(isSupportedTimeZone("Asia/Manila")).toBe(true);
    expect(isSupportedTimeZone("Europe/Berlin")).toBe(false);
    expect(isSupportedTimeZone(42)).toBe(false);
  });
});

describe("timeZoneAbbreviation", () => {
  it("uses the short label for a venue timezone", () => {
    expect(timeZoneAbbreviation("Asia/Kuala_Lumpur")).toBe("MYT");
    expect(timeZoneAbbreviation("Asia/Jakarta")).toBe("WIB");
  });

  it("falls back to the runtime's own label off the picklist", () => {
    expect(timeZoneAbbreviation("UTC")).toBeTruthy();
  });
});

describe("utcOffsetInTimeZone", () => {
  it("reads a whole-hour offset", () => {
    expect(
      utcOffsetInTimeZone(
        "Asia/Kuala_Lumpur",
        new Date("2026-08-10T00:00:00Z"),
      ),
    ).toBe("+08:00");
  });

  it("reads a half-hour offset", () => {
    expect(
      utcOffsetInTimeZone("Asia/Yangon", new Date("2026-08-10T00:00:00Z")),
    ).toBe("+06:30");
  });
});

describe("toInstantInTimeZone", () => {
  it("anchors a wall-clock time to the venue's offset", () => {
    expect(toInstantInTimeZone("2026-02-19T18:00", "Asia/Kuala_Lumpur")).toBe(
      "2026-02-19T18:00:00+08:00",
    );
  });

  it("names the same wall-clock time as a different instant per venue", () => {
    const kl = new Date(
      toInstantInTimeZone("2026-02-19T18:00", "Asia/Kuala_Lumpur"),
    );
    const bangkok = new Date(
      toInstantInTimeZone("2026-02-19T18:00", "Asia/Bangkok"),
    );
    expect(bangkok.getTime() - kl.getTime()).toBe(60 * 60 * 1000);
  });

  it("returns the input untouched when it isn't a datetime", () => {
    expect(toInstantInTimeZone("not-a-date", "Asia/Kuala_Lumpur")).toBe(
      "not-a-date",
    );
  });
});

describe("toLocalDateTimeInput", () => {
  it("round-trips a wall-clock time through the venue's timezone", () => {
    const instant = toInstantInTimeZone("2026-02-19T18:00", "Asia/Bangkok");
    expect(toLocalDateTimeInput(instant, "Asia/Bangkok")).toBe(
      "2026-02-19T18:00",
    );
  });

  it("shows an instant at the venue's wall clock, not UTC's", () => {
    expect(toLocalDateTimeInput("2026-02-19T16:00:00Z", "Asia/Manila")).toBe(
      "2026-02-20T00:00",
    );
  });

  it("returns an empty string for missing or unparseable input", () => {
    expect(toLocalDateTimeInput(null)).toBe("");
    expect(toLocalDateTimeInput("nonsense")).toBe("");
  });
});

describe("toCalendarDateInTimeZone", () => {
  it("reduces an instant to the venue's calendar day", () => {
    // 23:30 UTC is already the next day in Kuala Lumpur.
    expect(
      toCalendarDateInTimeZone("2026-02-19T23:30:00Z", "Asia/Kuala_Lumpur"),
    ).toBe("2026-02-20");
  });

  it("returns an empty string for missing or unparseable input", () => {
    expect(toCalendarDateInTimeZone(undefined)).toBe("");
    expect(toCalendarDateInTimeZone("nonsense")).toBe("");
  });
});

describe("calendar date arithmetic", () => {
  it("adds and subtracts days across month boundaries", () => {
    expect(addCalendarDays("2026-08-30", 7)).toBe("2026-09-06");
    expect(addCalendarDays("2026-03-01", -30)).toBe("2026-01-30");
  });

  it("finds the first and last day of a month", () => {
    expect(startOfMonth("2026-08-14")).toBe("2026-08-01");
    expect(endOfMonth("2026-08-14")).toBe("2026-08-31");
    expect(endOfMonth("2028-02-14")).toBe("2028-02-29");
  });

  it("offsets by whole months, including across a year end", () => {
    expect(startOfMonth("2026-12-14", 1)).toBe("2027-01-01");
    expect(endOfMonth("2026-12-14", 1)).toBe("2027-01-31");
  });

  it("leaves a malformed date alone rather than inventing one", () => {
    expect(addCalendarDays("", 1)).toBe("");
    expect(startOfMonth("14/08/2026")).toBe("14/08/2026");
  });
});

describe("formatCalendarDate", () => {
  it("renders the date's own day, whatever the runtime timezone", () => {
    // The bug this replaces: new Date("2026-08-10") is UTC midnight, which is
    // still the 9th anywhere west of Greenwich.
    expect(formatCalendarDate("2026-08-10")).toMatch(/10/);
    expect(formatCalendarDate("2026-08-10")).toMatch(/Aug/);
    expect(formatCalendarDate("2026-08-10")).toMatch(/2026/);
  });

  it("returns a malformed date unchanged", () => {
    expect(formatCalendarDate("soon")).toBe("soon");
  });
});

describe("formatCalendarDateRange", () => {
  it("collapses a single-day tournament to one date", () => {
    const label = formatCalendarDateRange("2026-08-10", "2026-08-10");
    expect(label).toMatch(/10 Aug 2026/);
    expect(label).not.toContain("–");
  });

  it("shows the year once for a multi-day tournament", () => {
    expect(formatCalendarDateRange("2026-08-10", "2026-08-12")).toBe(
      "10 Aug – 12 Aug 2026",
    );
  });

  it("names the venue's timezone when one is given", () => {
    expect(
      formatCalendarDateRange("2026-08-10", "2026-08-10", "Asia/Bangkok"),
    ).toBe("10 Aug 2026 (ICT)");
  });
});

describe("formatInstantDate", () => {
  it("reads a deadline on the venue's day, not the viewer's", () => {
    // 2026-02-19 16:30 UTC is already the 20th in Kuala Lumpur (UTC+8) but
    // still the 19th in Bangkok (UTC+7).
    expect(formatInstantDate("2026-02-19T16:30:00Z", "Asia/Kuala_Lumpur")).toBe(
      "20 Feb 2026 (MYT)",
    );
    expect(formatInstantDate("2026-02-19T16:30:00Z", "Asia/Bangkok")).toBe(
      "19 Feb 2026 (ICT)",
    );
  });

  it("can omit the zone label where the surrounding copy already names it", () => {
    expect(
      formatInstantDate("2026-02-19T04:00:00Z", "Asia/Kuala_Lumpur", {
        withZone: false,
      }),
    ).toBe("19 Feb 2026");
  });

  it("returns an unparseable value unchanged", () => {
    expect(formatInstantDate("whenever", "Asia/Kuala_Lumpur")).toBe("whenever");
  });
});
