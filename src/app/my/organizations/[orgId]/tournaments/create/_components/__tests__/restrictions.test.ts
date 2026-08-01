import { describe, expect, it } from "vitest";
import {
  toPersistedRestrictions,
  fromPersistedRestrictions,
} from "../restrictions";
import type { Restriction } from "../../types";
import { normalizeRestrictions } from "@/app/api/v1/tournaments/[slug]/registrations/validators";

const stripIds = (rows: Restriction[]) =>
  rows.map(({ kind, value }) => ({ kind, value }));

describe("toPersistedRestrictions", () => {
  it("maps each row kind to its normalized shape", () => {
    expect(
      toPersistedRestrictions([
        { kind: "max_age", value: "18" },
        { kind: "min_rating", value: "1000" },
        { kind: "max_rating", value: "2000" },
        { kind: "gender", value: "Female" },
        { kind: "nationality", value: "Malaysia" },
      ]),
    ).toEqual([
      { type: "age", max: 18 },
      { type: "rating", min: 1000 },
      { type: "rating", max: 2000 },
      { type: "gender", value: "female" },
      { type: "nationality", value: "Malaysia" },
    ]);
  });

  it("stores a null number for a blank numeric value", () => {
    expect(toPersistedRestrictions([{ kind: "max_age", value: "" }])).toEqual([
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
      { kind: "max_age", value: "18" },
      { kind: "min_rating", value: "1000" },
      { kind: "max_rating", value: "2000" },
      { kind: "gender", value: "female" },
      { kind: "nationality", value: "Malaysia" },
    ]);
  });

  it("splits a stored item carrying both rating bounds into two rows", () => {
    expect(
      stripIds(
        fromPersistedRestrictions([{ type: "rating", min: 1000, max: 2000 }]),
      ),
    ).toEqual([
      { kind: "min_rating", value: "1000" },
      { kind: "max_rating", value: "2000" },
    ]);
  });

  it("gives every row a distinct key", () => {
    const rows = fromPersistedRestrictions([
      { type: "rating", min: 1000, max: 2000 },
      { type: "age", max: 18 },
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
});

describe("round-trip", () => {
  it("preserves rows through persist → hydrate", () => {
    const rows = [
      { kind: "max_age" as const, value: "18" },
      { kind: "min_rating" as const, value: "1000" },
      { kind: "nationality" as const, value: "Malaysia" },
      { kind: "gender" as const, value: "female" },
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
      { kind: "nationality", value: "Malaysia" },
      { kind: "max_age", value: "18" },
    ]);
    expect(normalizeRestrictions(persisted)).toEqual({
      nationality: "Malaysia",
      max_age: 18,
    });
  });
});
