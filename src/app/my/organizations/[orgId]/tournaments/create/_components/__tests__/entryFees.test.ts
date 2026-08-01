import { describe, expect, it } from "vitest";
import {
  fromPersistedEntryFees,
  fromValidUntilTimestamp,
  toPersistedEntryFees,
  toValidUntilTimestamp,
} from "../entryFees";
import type { FeeTier, FeesData, StoredEntryFees } from "../../types";

function tier(overrides: Partial<FeeTier> & Pick<FeeTier, "type">): FeeTier {
  return {
    amount: "",
    validUntil: "",
    titles: [],
    ratingFrom: "",
    ratingTo: "",
    ageFrom: "",
    ageTo: "",
    ...overrides,
  };
}

describe("toPersistedEntryFees", () => {
  it("writes the canonical key names every consumer reads", () => {
    const persisted = toPersistedEntryFees({
      standardFee: 50,
      tiers: [
        tier({ type: "early_bird", amount: 40, validUntil: "2026-02-19" }),
        tier({ type: "titled_players", amount: 0, titles: ["GM", "IM"] }),
        tier({
          type: "rating_based",
          amount: 35,
          ratingFrom: 0,
          ratingTo: 1800,
        }),
        tier({ type: "age_based", amount: 30, ageFrom: 0, ageTo: 12 }),
      ],
    });

    expect(persisted).toEqual({
      standard: { amount_cents: 5000 },
      additional: [
        {
          type: "early_bird",
          amount_cents: 4000,
          valid_until: "2026-02-19T23:59:59+08:00",
        },
        { type: "titled_players", amount_cents: 0, titles: ["GM", "IM"] },
        {
          type: "rating_based",
          amount_cents: 3500,
          rating_min: 0,
          rating_max: 1800,
        },
        { type: "age_based", amount_cents: 3000, age_min: 0, age_max: 12 },
      ],
    });
  });

  it("omits criteria that were left blank", () => {
    const persisted = toPersistedEntryFees({
      standardFee: "",
      tiers: [
        tier({ type: "early_bird", amount: "" }),
        tier({ type: "age_based", amount: 20, ageFrom: 8, ageTo: "" }),
      ],
    });

    expect(persisted).toEqual({
      standard: { amount_cents: 0 },
      additional: [
        { type: "early_bird", amount_cents: 0 },
        { type: "age_based", amount_cents: 2000, age_min: 8 },
      ],
    });
  });
});

describe("fromPersistedEntryFees", () => {
  it("restores the criteria of a canonically stored tournament (#478)", () => {
    // The shape written by db/migrations/006_seed.sql: `age_min`/`age_max` and
    // a full timestamp for `valid_until`.
    const stored: StoredEntryFees = {
      standard: { amount_cents: 5000 },
      additional: [
        {
          type: "early_bird",
          amount_cents: 4000,
          valid_until: "2026-02-19T23:59:59+08:00",
        },
        { type: "age_based", amount_cents: 3000, age_min: 0, age_max: 12 },
      ],
    };

    expect(fromPersistedEntryFees(stored)).toEqual({
      standardFee: 50,
      tiers: [
        {
          type: "early_bird",
          amount: 40,
          validUntil: "2026-02-19",
          titles: [],
          ratingFrom: "",
          ratingTo: "",
          ageFrom: "",
          ageTo: "",
        },
        {
          type: "age_based",
          amount: 30,
          validUntil: "",
          titles: [],
          ratingFrom: "",
          ratingTo: "",
          ageFrom: 0,
          ageTo: 12,
        },
      ],
    });
  });

  it("skips tiers the wizard cannot edit instead of coercing them", () => {
    const fees = fromPersistedEntryFees({
      standard: { amount_cents: 5000 },
      additional: [
        { type: "standard", amount_cents: 5000 },
        { type: "gender", amount_cents: 2500 },
        { type: "age_based", amount_cents: 3000, age_min: 0, age_max: 12 },
      ],
    });

    expect(fees.tiers.map((t) => t.type)).toEqual(["age_based"]);
  });

  it("falls back to an empty form for a tournament with no fees", () => {
    expect(fromPersistedEntryFees(null)).toEqual({
      standardFee: "",
      tiers: [],
    });
  });
});

describe("entry fee round trip", () => {
  it("survives save → resume unchanged", () => {
    const original: FeesData = {
      standardFee: 50,
      tiers: [
        tier({ type: "early_bird", amount: 40, validUntil: "2026-02-19" }),
        tier({ type: "titled_players", amount: 0, titles: ["GM"] }),
        tier({
          type: "rating_based",
          amount: 35,
          ratingFrom: 1200,
          ratingTo: 1800,
        }),
        tier({ type: "age_based", amount: 30, ageFrom: 0, ageTo: 12 }),
      ],
    };

    expect(fromPersistedEntryFees(toPersistedEntryFees(original))).toEqual(
      original,
    );
  });
});

describe("valid_until", () => {
  it("anchors the picked date to the end of that day in the venue timezone", () => {
    // The tier must stay usable for the whole of the 19th — storing the bare
    // date would expire it at 08:00 local.
    const stamp = toValidUntilTimestamp("2026-02-19");
    expect(stamp).toBe("2026-02-19T23:59:59+08:00");
    expect(new Date(stamp).toISOString()).toBe("2026-02-19T15:59:59.000Z");
  });

  it("reduces a stored timestamp to its venue-local calendar date", () => {
    expect(fromValidUntilTimestamp("2026-02-19T23:59:59+08:00")).toBe(
      "2026-02-19",
    );
    // Late UTC on the 19th is already the 20th in KL.
    expect(fromValidUntilTimestamp("2026-02-19T20:00:00Z")).toBe("2026-02-20");
  });

  it("returns an empty string for missing or unparseable values", () => {
    expect(fromValidUntilTimestamp(null)).toBe("");
    expect(fromValidUntilTimestamp("")).toBe("");
    expect(fromValidUntilTimestamp("not a date")).toBe("");
  });

  it("ends the tier when the day ends at the venue, not in Malaysia", () => {
    // A Bangkok tournament's early-bird day ends an hour after a KL one's.
    expect(toValidUntilTimestamp("2026-02-19", "Asia/Bangkok")).toBe(
      "2026-02-19T23:59:59+07:00",
    );
    // And reads back as the same calendar day at that venue.
    expect(
      fromValidUntilTimestamp("2026-02-19T23:59:59+07:00", "Asia/Bangkok"),
    ).toBe("2026-02-19");
  });

  it("round-trips a tier's valid_until through the venue timezone", () => {
    const fees: FeesData = {
      standardFee: 50,
      tiers: [
        tier({ type: "early_bird", amount: 40, validUntil: "2026-02-19" }),
      ],
    };
    const persisted = toPersistedEntryFees(fees, "Asia/Manila");
    expect(persisted.additional[0].valid_until).toBe(
      "2026-02-19T23:59:59+08:00",
    );
    expect(
      fromPersistedEntryFees(persisted as StoredEntryFees, "Asia/Manila")
        .tiers[0].validUntil,
    ).toBe("2026-02-19");
  });
});
