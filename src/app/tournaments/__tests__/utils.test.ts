import { describe, expect, it } from "vitest";
import {
  formatRm,
  toTitleCase,
  calculateAge,
  checkAgeEligibility,
  checkRatingEligibility,
  describeRatingList,
  resolvePlayerRating,
  getTournamentDateState,
  getMinFeeCents,
} from "../utils";
import { getTodayInTimeZone } from "@/lib/datetime";
import type { EntryFees } from "../types";

describe("getTournamentDateState", () => {
  it("buckets against the day it is given", () => {
    expect(
      getTournamentDateState("2026-08-10", "2026-08-12", "2026-08-09"),
    ).toBe("upcoming");
    expect(
      getTournamentDateState("2026-08-10", "2026-08-12", "2026-08-12"),
    ).toBe("ongoing");
    expect(
      getTournamentDateState("2026-08-10", "2026-08-12", "2026-08-13"),
    ).toBe("completed");
  });

  it("can differ between two venues at the same instant", () => {
    // 2026-08-09 17:00 UTC: already the 10th in Manila, still the 9th in Yangon,
    // so the same one-day event is ongoing at one venue and upcoming at the other.
    const instant = new Date("2026-08-09T17:00:00Z");
    expect(
      getTournamentDateState(
        "2026-08-10",
        "2026-08-10",
        getTodayInTimeZone("Asia/Manila", instant),
      ),
    ).toBe("ongoing");
    expect(
      getTournamentDateState(
        "2026-08-10",
        "2026-08-10",
        getTodayInTimeZone("Asia/Yangon", instant),
      ),
    ).toBe("upcoming");
  });
});

describe("getMinFeeCents", () => {
  it("returns the standard amount when there are no additional tiers", () => {
    expect(getMinFeeCents({ standard: { amount_cents: 5000 } })).toBe(5000);
  });

  it("returns the cheapest tier across standard and additional", () => {
    expect(
      getMinFeeCents({
        standard: { amount_cents: 5000 },
        additional: [{ type: "early_bird", amount_cents: 3000 }],
      }),
    ).toBe(3000);
  });

  it("keeps 0 for a genuinely free standard tier", () => {
    expect(getMinFeeCents({ standard: { amount_cents: 0 } })).toBe(0);
  });

  it("ignores a missing standard amount instead of treating it as free", () => {
    const fees = {
      standard: {},
      additional: [{ type: "early_bird", amount_cents: 2000 }],
    } as unknown as EntryFees;
    expect(getMinFeeCents(fees)).toBe(2000);
  });

  it("ignores additional tiers with non-finite amounts (no NaN)", () => {
    const fees = {
      standard: { amount_cents: 5000 },
      additional: [{ type: "broken", amount_cents: undefined }],
    } as unknown as EntryFees;
    const result = getMinFeeCents(fees);
    expect(result).toBe(5000);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("returns 0 when there are no valid amounts", () => {
    expect(getMinFeeCents(null)).toBe(0);
    expect(getMinFeeCents({} as unknown as EntryFees)).toBe(0);
  });
});

describe("formatRm", () => {
  it("returns 'Free' for 0 cents", () => {
    expect(formatRm(0)).toBe("Free");
  });

  it("formats whole RM amounts with two decimal places", () => {
    expect(formatRm(3000)).toBe("RM30.00");
    expect(formatRm(2400)).toBe("RM24.00");
    expect(formatRm(1800)).toBe("RM18.00");
  });

  it("formats RM1 from 100 cents", () => {
    expect(formatRm(100)).toBe("RM1.00");
  });

  it("does not truncate cents (#359)", () => {
    expect(formatRm(10)).toBe("RM0.10");
    expect(formatRm(5050)).toBe("RM50.50");
  });

  it("formats thousands with a thousands separator", () => {
    const result = formatRm(100000);
    expect(result).toMatch(/^RM1.000\.00$/);
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

describe("checkAgeEligibility", () => {
  // Event starts 1 July 2026. An "under 12" cap (age_max: 12) admits anyone who
  // has NOT reached 12 before the start date, i.e. born on/after 2014-07-01.
  const start = new Date("2026-07-01");

  it("admits a player who turns the cap age exactly on the start date (boundary)", () => {
    expect(checkAgeEligibility(new Date("2014-07-01"), start, null, 12)).toBe(
      null,
    );
  });

  it("rejects a player who turned the cap age one day before the start date", () => {
    expect(checkAgeEligibility(new Date("2014-06-30"), start, null, 12)).toBe(
      "too_old",
    );
  });

  it("rejects a 12y5m player for an age_max 12 tier (the reported regression)", () => {
    // Born 2014-02-01 → 12 years 5 months on the 2026-07-01 start date.
    expect(checkAgeEligibility(new Date("2014-02-01"), start, null, 12)).toBe(
      "too_old",
    );
  });

  it("admits a clearly-younger player for an age_max cap", () => {
    expect(checkAgeEligibility(new Date("2016-01-01"), start, null, 12)).toBe(
      null,
    );
  });

  it("admits a player who reaches the min age exactly on the start date (boundary)", () => {
    // age_min 17: must have reached 17 by the start → born on/before 2009-07-01.
    expect(checkAgeEligibility(new Date("2009-07-01"), start, 17, null)).toBe(
      null,
    );
  });

  it("rejects a player who reaches the min age one day after the start date", () => {
    expect(checkAgeEligibility(new Date("2009-07-02"), start, 17, null)).toBe(
      "too_young",
    );
  });

  it("checks too_young before too_old when both bounds are set", () => {
    // Band [12, 15]. A 10-year-old (born 2016-07-01) is too_young.
    expect(checkAgeEligibility(new Date("2016-07-01"), start, 12, 15)).toBe(
      "too_young",
    );
    // A 16-year-old (born 2010-01-01) is too_old.
    expect(checkAgeEligibility(new Date("2010-01-01"), start, 12, 15)).toBe(
      "too_old",
    );
    // Squarely inside the band.
    expect(checkAgeEligibility(new Date("2013-01-01"), start, 12, 15)).toBe(
      null,
    );
  });

  it("returns null when no age bounds are set", () => {
    expect(checkAgeEligibility(new Date("2000-01-01"), start, null, null)).toBe(
      null,
    );
  });
});

describe("resolvePlayerRating", () => {
  const fide = (formatType: string) => ({
    formatType,
    isFideRated: true,
    isMcfRated: false,
  });
  const mcf = (formatType: string) => ({
    formatType,
    isFideRated: false,
    isMcfRated: true,
  });
  const unratedEvent = (formatType: string) => ({
    formatType,
    isFideRated: false,
    isMcfRated: false,
  });

  const profile = {
    fide_rating: { standard: 2000, rapid: 1900, blitz: 1800 },
    national_rating: 1500,
  };

  it("uses the blitz list for a blitz tournament", () => {
    expect(resolvePlayerRating(profile, fide("blitz"))).toBe(1800);
  });

  it("uses the rapid list for a rapid tournament", () => {
    expect(resolvePlayerRating(profile, fide("rapid"))).toBe(1900);
  });

  it("uses the standard list for a classical tournament", () => {
    expect(resolvePlayerRating(profile, fide("classical"))).toBe(2000);
  });

  it("treats an unknown format as standard", () => {
    expect(resolvePlayerRating(profile, fide("swiss"))).toBe(2000);
  });

  it("does not substitute another FIDE list when the format's own is missing", () => {
    expect(
      resolvePlayerRating(
        { fide_rating: { standard: 2000 }, national_rating: 1500 },
        fide("blitz"),
      ),
    ).toBeNull();
  });

  it("does not substitute the national rating on a FIDE-rated tournament", () => {
    expect(
      resolvePlayerRating(
        { fide_rating: null, national_rating: 1500 },
        fide("classical"),
      ),
    ).toBeNull();
  });

  it("reads only the national rating on an MCF-rated tournament", () => {
    expect(resolvePlayerRating(profile, mcf("classical"))).toBe(1500);
    expect(
      resolvePlayerRating(
        { fide_rating: { standard: 2000 }, national_rating: null },
        mcf("classical"),
      ),
    ).toBeNull();
  });

  it("takes whichever rating exists when neither federation rates the event", () => {
    expect(resolvePlayerRating(profile, unratedEvent("classical"))).toBe(2000);
    expect(
      resolvePlayerRating(
        { fide_rating: null, national_rating: 1500 },
        unratedEvent("classical"),
      ),
    ).toBe(1500);
  });

  it("returns null for a player with no ratings at all", () => {
    expect(
      resolvePlayerRating(
        { fide_rating: null, national_rating: null },
        fide("classical"),
      ),
    ).toBeNull();
  });

  it("returns null for a null profile", () => {
    expect(resolvePlayerRating(null, fide("classical"))).toBeNull();
  });

  it("ignores a non-numeric jsonb rating rather than comparing it as a string", () => {
    expect(
      resolvePlayerRating(
        {
          fide_rating: { standard: "1800" } as unknown as Record<
            string,
            number
          >,
          national_rating: 1500,
        },
        fide("classical"),
      ),
    ).toBeNull();
  });
});

describe("describeRatingList", () => {
  it("names the FIDE list for a FIDE-rated tournament", () => {
    expect(
      describeRatingList({
        formatType: "classical",
        isFideRated: true,
        isMcfRated: false,
      }),
    ).toBe("FIDE standard");
    expect(
      describeRatingList({
        formatType: "blitz",
        isFideRated: true,
        isMcfRated: false,
      }),
    ).toBe("FIDE blitz");
  });

  it("names the national list for an MCF-rated tournament", () => {
    expect(
      describeRatingList({
        formatType: "rapid",
        isFideRated: false,
        isMcfRated: true,
      }),
    ).toBe("national (MCF)");
  });

  it("names both when neither federation rates the event", () => {
    expect(
      describeRatingList({
        formatType: "rapid",
        isFideRated: false,
        isMcfRated: false,
      }),
    ).toBe("FIDE rapid or national");
  });
});

describe("checkRatingEligibility", () => {
  it("returns null when the rating is inside the range", () => {
    expect(checkRatingEligibility(1700, 1500, 1800)).toBeNull();
  });

  it("treats both bounds as inclusive", () => {
    expect(checkRatingEligibility(1500, 1500, 1800)).toBeNull();
    expect(checkRatingEligibility(1800, 1500, 1800)).toBeNull();
  });

  it("flags a rating below the floor", () => {
    expect(checkRatingEligibility(1499, 1500, null)).toBe("below_min");
  });

  it("flags a rating above the cap", () => {
    expect(checkRatingEligibility(1801, null, 1800)).toBe("above_max");
  });

  it("blocks an unrated player from a floor", () => {
    expect(checkRatingEligibility(null, 1500, null)).toBe("below_min");
  });

  it("admits an unrated player under a cap", () => {
    expect(checkRatingEligibility(null, null, 1800)).toBeNull();
  });

  it("returns null when no bounds are set", () => {
    expect(checkRatingEligibility(null, null, null)).toBeNull();
    expect(checkRatingEligibility(2400, null, null)).toBeNull();
  });
});
