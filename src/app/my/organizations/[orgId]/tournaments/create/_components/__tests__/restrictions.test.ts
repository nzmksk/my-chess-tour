import { describe, expect, it } from "vitest";
import {
  toPersistedRestrictions,
  fromPersistedRestrictions,
} from "../restrictions";
import { normalizeRestrictions } from "@/app/api/v1/tournaments/[slug]/registrations/validators";

const stripIds = (rows: Array<{ type: string; value: string }>) =>
  rows.map(({ type, value }) => ({ type, value }));

describe("toPersistedRestrictions", () => {
  it("maps each wizard label to its normalized shape", () => {
    expect(
      toPersistedRestrictions([
        { type: "Max Age", value: "18" },
        { type: "Min Rating", value: "1000" },
        { type: "Max Rating", value: "2000" },
        { type: "Gender", value: "Female" },
        { type: "Nationality", value: "Malaysia" },
        { type: "State", value: "Selangor" },
        { type: "Custom", value: "Members only" },
      ]),
    ).toEqual([
      { type: "age", max: 18 },
      { type: "rating", min: 1000 },
      { type: "rating", max: 2000 },
      { type: "gender", value: "female" },
      { type: "nationality", value: "Malaysia" },
      { type: "state", value: "Selangor" },
      { type: "custom", value: "Members only" },
    ]);
  });

  it("stores a null number for a blank numeric value", () => {
    expect(toPersistedRestrictions([{ type: "Max Age", value: "" }])).toEqual([
      { type: "age", max: null },
    ]);
  });
});

describe("fromPersistedRestrictions", () => {
  it("expands normalized restrictions back into wizard rows", () => {
    expect(
      stripIds(
        fromPersistedRestrictions([
          { type: "age", max: 18 },
          { type: "rating", min: 1000 },
          { type: "rating", max: 2000 },
          { type: "gender", value: "female" },
          { type: "nationality", value: "Malaysia" },
        ]),
      ),
    ).toEqual([
      { type: "Max Age", value: "18" },
      { type: "Min Rating", value: "1000" },
      { type: "Max Rating", value: "2000" },
      { type: "Gender", value: "female" },
      { type: "Nationality", value: "Malaysia" },
    ]);
  });
});

describe("round-trip", () => {
  it("preserves rows through persist → hydrate", () => {
    const rows = [
      { type: "Max Age", value: "18" },
      { type: "Min Rating", value: "1000" },
      { type: "Nationality", value: "Malaysia" },
      { type: "Gender", value: "female" },
    ];
    const roundTripped = stripIds(
      fromPersistedRestrictions(toPersistedRestrictions(rows)),
    );
    expect(roundTripped).toEqual(rows);
  });
});

describe("enforcement integration", () => {
  it("produces restrictions that normalizeRestrictions actually recognizes", () => {
    // The bug this fixes: wizard restrictions were stored as unrecognized UI
    // labels. The mapped output must normalize to enforceable fields.
    const persisted = toPersistedRestrictions([
      { type: "Nationality", value: "Malaysia" },
      { type: "Max Age", value: "18" },
    ]);
    expect(normalizeRestrictions(persisted)).toEqual({
      nationality: "Malaysia",
      max_age: 18,
    });
  });
});
