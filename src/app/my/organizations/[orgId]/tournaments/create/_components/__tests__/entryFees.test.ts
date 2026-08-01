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

function feesData(overrides: Partial<FeesData> = {}): FeesData {
  return { standardFee: "", tiers: [], preservedTiers: [], ...overrides };
}

describe("toPersistedEntryFees", () => {
  it("writes the canonical key names every consumer reads", () => {
    const persisted = toPersistedEntryFees(
      feesData({
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
      }),
    );

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
    const persisted = toPersistedEntryFees(
      feesData({
        tiers: [
          tier({ type: "early_bird", amount: "" }),
          tier({ type: "age_based", amount: 20, ageFrom: 8, ageTo: "" }),
        ],
      }),
    );

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
      preservedTiers: [],
      tiers: [
        {
          type: "early_bird",
          amount: 40,
          validUntil: "2026-02-19",
          validUntilSource: "2026-02-19T23:59:59+08:00",
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
          validUntilSource: undefined,
          titles: [],
          ratingFrom: "",
          ratingTo: "",
          ageFrom: 0,
          ageTo: 12,
        },
      ],
    });
  });

  it("sets aside tiers the wizard cannot edit instead of coercing them", () => {
    const fees = fromPersistedEntryFees({
      standard: { amount_cents: 5000 },
      additional: [
        { type: "standard", amount_cents: 5000 },
        { type: "gender", amount_cents: 2500 },
        { type: "age_based", amount_cents: 3000, age_min: 0, age_max: 12 },
      ],
    });

    expect(fees.tiers.map((t) => t.type)).toEqual(["age_based"]);
    expect(fees.preservedTiers).toEqual([
      { index: 0, tier: { type: "standard", amount_cents: 5000 } },
      { index: 1, tier: { type: "gender", amount_cents: 2500 } },
    ]);
  });

  it("falls back to an empty form for a tournament with no fees", () => {
    expect(fromPersistedEntryFees(null)).toEqual({
      standardFee: "",
      tiers: [],
      preservedTiers: [],
    });
  });
});

describe("entry fee round trip", () => {
  it("survives save → resume unchanged", () => {
    const original = feesData({
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
    });

    const restored = fromPersistedEntryFees(toPersistedEntryFees(original));

    // Resuming a draft picks up the instant that was just written, so the next
    // save can reproduce it exactly. Nothing else about the form changes.
    expect(restored.tiers[0].validUntilSource).toBe(
      "2026-02-19T23:59:59+08:00",
    );
    expect(restored).toEqual({
      ...original,
      tiers: original.tiers.map((t, i) => ({
        ...t,
        validUntilSource: restored.tiers[i].validUntilSource,
      })),
    });
  });

  // The regression this suite exists to hold. `entry_fees` is jsonb, and both
  // the PATCH route's deepEquals and guard_tournament_money_fields' IS DISTINCT
  // FROM read any difference at all as a fee change — which is refused outright
  // on a tournament that has taken payment. So hydrating a row and saving it
  // back untouched has to reproduce it byte for byte, whatever shape it is in.
  it.each([
    ["canonical end-of-day", "2026-02-19T23:59:59+08:00"],
    ["a midnight instant, as the seed wrote", "2026-02-19T00:00:00+00:00"],
    ["a bare calendar date, as the wizard once wrote", "2026-02-19"],
  ])("re-saves an untouched tier holding %s verbatim", (_label, stamp) => {
    const stored: StoredEntryFees = {
      standard: { amount_cents: 5000 },
      additional: [
        { type: "early_bird", amount_cents: 4000, valid_until: stamp },
        { type: "age_based", amount_cents: 3000, age_min: 0, age_max: 12 },
      ],
    };

    expect(toPersistedEntryFees(fromPersistedEntryFees(stored))).toEqual(
      stored,
    );
  });

  it("carries a non-editable tier through at its original index", () => {
    const stored: StoredEntryFees = {
      standard: { amount_cents: 5000 },
      additional: [
        { type: "gender", amount_cents: 2500 },
        {
          type: "early_bird",
          amount_cents: 4000,
          valid_until: "2026-02-19T23:59:59+08:00",
        },
        { type: "oku", amount_cents: 1000 },
      ],
    };

    expect(toPersistedEntryFees(fromPersistedEntryFees(stored))).toEqual(
      stored,
    );
  });

  it("normalises a date the organizer actually moved", () => {
    const hydrated = fromPersistedEntryFees({
      standard: { amount_cents: 5000 },
      additional: [
        {
          type: "early_bird",
          amount_cents: 4000,
          valid_until: "2026-02-19T00:00:00+00:00",
        },
      ],
    });

    hydrated.tiers[0].validUntil = "2026-02-25";

    expect(toPersistedEntryFees(hydrated).additional[0]).toEqual({
      type: "early_bird",
      amount_cents: 4000,
      valid_until: "2026-02-25T23:59:59+08:00",
    });
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
    const persisted = toPersistedEntryFees(
      feesData({
        standardFee: 50,
        tiers: [
          tier({ type: "early_bird", amount: 40, validUntil: "2026-02-19" }),
        ],
      }),
      "Asia/Manila",
    );
    expect(persisted.additional[0].valid_until).toBe(
      "2026-02-19T23:59:59+08:00",
    );
    expect(
      fromPersistedEntryFees(persisted as StoredEntryFees, "Asia/Manila")
        .tiers[0].validUntil,
    ).toBe("2026-02-19");
  });
});
