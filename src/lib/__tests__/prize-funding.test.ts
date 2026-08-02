import { describe, it, expect } from "vitest";
import {
  PRIZE_FUNDING_SOURCES,
  isPrizeDistribution,
  isPrizeFundingSource,
  totalDeclaredPrizeCents,
  validatePrizeFunding,
  validatePrizeStructure,
  type PrizesJson,
} from "../prize-funding";

const SPONSORED = { source: "sponsor" as const, funder_name: "ACME Sdn Bhd" };

describe("funding sources", () => {
  it("never accepts entry fees as a prize funding source", () => {
    // The whole design rests on this: entry fees are an administration fee and
    // prize money must come from outside the pool of competitors.
    expect(PRIZE_FUNDING_SOURCES).not.toContain("entry_fees");
    expect(isPrizeFundingSource("entry_fees")).toBe(false);
  });

  it("accepts the three external sources and nothing else", () => {
    expect(isPrizeFundingSource("sponsor")).toBe(true);
    expect(isPrizeFundingSource("grant")).toBe(true);
    expect(isPrizeFundingSource("organizer")).toBe(true);
    expect(isPrizeFundingSource("registrations")).toBe(false);
    expect(isPrizeFundingSource(null)).toBe(false);
  });

  it("validates distribution modes", () => {
    expect(isPrizeDistribution("organizer")).toBe(true);
    expect(isPrizeDistribution("platform")).toBe(true);
    expect(isPrizeDistribution("sponsor")).toBe(false);
  });
});

describe("totalDeclaredPrizeCents", () => {
  it("is 0 for null/empty prizes", () => {
    expect(totalDeclaredPrizeCents(null)).toBe(0);
    expect(totalDeclaredPrizeCents({})).toBe(0);
  });

  it("sums categories and special prizes together", () => {
    const prizes: PrizesJson = {
      categories: [
        {
          name: "Open",
          funding: SPONSORED,
          entries: [{ amount_cents: 80000 }, { amount_cents: 48000 }],
        },
      ],
      special: [
        { name: "Best Female", funding: SPONSORED, amount_cents: 20000 },
      ],
    };
    expect(totalDeclaredPrizeCents(prizes)).toBe(148000);
  });

  it("ignores entries with no amount", () => {
    const prizes: PrizesJson = {
      categories: [{ name: "Open", entries: [{ place: "1st" }] }],
    };
    expect(totalDeclaredPrizeCents(prizes)).toBe(0);
  });
});

describe("validatePrizeFunding", () => {
  it("passes when there are no prizes at all", () => {
    expect(validatePrizeFunding(null)).toEqual([]);
    expect(validatePrizeFunding({ categories: [], special: [] })).toEqual([]);
  });

  it("passes when every funded prize names its source", () => {
    const prizes: PrizesJson = {
      categories: [
        {
          name: "Open",
          funding: SPONSORED,
          entries: [{ amount_cents: 50000 }],
        },
      ],
      special: [
        { name: "Best Junior", funding: SPONSORED, amount_cents: 10000 },
      ],
      distribution: "organizer",
    };
    expect(validatePrizeFunding(prizes)).toEqual([]);
  });

  it("rejects a funded category with no funding declared", () => {
    const prizes: PrizesJson = {
      categories: [{ name: "Open", entries: [{ amount_cents: 50000 }] }],
    };
    const errors = validatePrizeFunding(prizes);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Open");
  });

  it("rejects a declared source with no funder named", () => {
    const prizes: PrizesJson = {
      categories: [
        {
          name: "Open",
          funding: { source: "sponsor", funder_name: "   " },
          entries: [{ amount_cents: 50000 }],
        },
      ],
    };
    expect(validatePrizeFunding(prizes)[0]).toMatch(/name the sponsor/i);
  });

  it("ignores a category with no money attached", () => {
    // An empty category is a structural placeholder, not a promise to pay.
    const prizes: PrizesJson = {
      categories: [{ name: "Open", entries: [{ place: "1st" }] }],
    };
    expect(validatePrizeFunding(prizes)).toEqual([]);
  });

  it("reports every offending prize, not just the first", () => {
    const prizes: PrizesJson = {
      categories: [
        { name: "Open", entries: [{ amount_cents: 50000 }] },
        { name: "Under-12", entries: [{ amount_cents: 20000 }] },
      ],
      special: [{ name: "Best Veteran", amount_cents: 10000 }],
    };
    expect(validatePrizeFunding(prizes)).toHaveLength(3);
  });

  it("falls back to a generic label for an unnamed category", () => {
    const prizes: PrizesJson = {
      categories: [{ entries: [{ amount_cents: 50000 }] }],
    };
    expect(validatePrizeFunding(prizes)[0]).toMatch(/^Prize category/);
  });

  it("rejects an unknown distribution mode", () => {
    const prizes = {
      distribution: "sponsor",
    } as unknown as PrizesJson;
    expect(validatePrizeFunding(prizes)[0]).toMatch(/organizer or platform/);
  });
});

describe("validatePrizeStructure", () => {
  const SPECIAL = [
    { name: "Best Female Player", funding: SPONSORED, amount_cents: 20000 },
  ];

  it("accepts special prizes alongside a filled category", () => {
    const prizes: PrizesJson = {
      categories: [
        { name: "Open", funding: SPONSORED, entries: [{ amount_cents: 50000 }] },
      ],
      special: SPECIAL,
    };
    expect(validatePrizeStructure(prizes)).toEqual([]);
  });

  it("rejects special prizes with no categories at all", () => {
    expect(validatePrizeStructure({ categories: [], special: SPECIAL })).toEqual(
      [
        "Add at least one prize category with a placing — special prizes cannot be the only prizes a tournament awards",
      ],
    );
  });

  it("rejects special prizes when the categories key is absent", () => {
    expect(validatePrizeStructure({ special: SPECIAL })).toHaveLength(1);
  });

  // A named category with no entries is a placeholder, not a prize.
  it("rejects special prizes when every category is empty", () => {
    const prizes: PrizesJson = {
      categories: [{ name: "Open", entries: [] }, { name: "Under-12" }],
      special: SPECIAL,
    };
    expect(validatePrizeStructure(prizes)).toHaveLength(1);
  });

  it("accepts a non-monetary category as filled", () => {
    const prizes: PrizesJson = {
      categories: [{ name: "Open", entries: [{ place: "1st" }] }],
      special: SPECIAL,
    };
    expect(validatePrizeStructure(prizes)).toEqual([]);
  });

  it("ignores tournaments with no special prizes", () => {
    expect(validatePrizeStructure({ categories: [], special: [] })).toEqual([]);
    expect(validatePrizeStructure({ categories: [] })).toEqual([]);
  });

  it("ignores a tournament with no prizes declared", () => {
    expect(validatePrizeStructure(null)).toEqual([]);
    expect(validatePrizeStructure(undefined)).toEqual([]);
  });
});
