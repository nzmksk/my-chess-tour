// Bidirectional mapping between the wizard's per-row restriction UI and the
// normalized shape stored in the DB and consumed by normalizeRestrictions /
// checkRestrictions at registration time.
//
// Persisting the normalized shape is what makes wizard-created restrictions
// actually enforce. The two shapes still differ in one way: a row constrains
// exactly one end of one dimension ("max_rating"), while a stored item may
// carry both ends ({ type: "rating", min, max }), so reading expands and
// writing does not merge.

import type {
  PersistedRestriction,
  Restriction,
  RestrictionKind,
} from "../types";

/** The restriction kinds on offer, in the order the row's picker lists them. */
export const RESTRICTION_KINDS: RestrictionKind[] = [
  "max_age",
  "max_rating",
  "min_rating",
  "gender",
  "nationality",
];

export const RESTRICTION_LABELS: Record<RestrictionKind, string> = {
  max_age: "Max Age",
  max_rating: "Max Rating",
  min_rating: "Min Rating",
  gender: "Gender",
  nationality: "Nationality",
};

function toNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Wizard rows → normalized restrictions for persistence. */
export function toPersistedRestrictions(
  rows: ReadonlyArray<Pick<Restriction, "kind" | "value">>,
): PersistedRestriction[] {
  return rows.map((r) => {
    const value = r.value.trim();
    switch (r.kind) {
      case "max_age":
        return { type: "age", max: toNumberOrNull(value) };
      case "min_rating":
        return { type: "rating", min: toNumberOrNull(value) };
      case "max_rating":
        return { type: "rating", max: toNumberOrNull(value) };
      case "gender":
        // checkRestrictions compares against the lowercase profile gender.
        return { type: "gender", value: value.toLowerCase() };
      case "nationality":
        return { type: "nationality", value };
    }
  });
}

/** Normalized restrictions (from the DB) → wizard rows for editing. */
export function fromPersistedRestrictions(
  items: ReadonlyArray<PersistedRestriction>,
): Restriction[] {
  const rows: Restriction[] = [];
  let idx = 0;
  const push = (kind: RestrictionKind, value: string) =>
    rows.push({ id: `r-${idx++}`, kind, value });

  for (const item of items) {
    switch (item.type) {
      case "age":
        push("max_age", item.max != null ? String(item.max) : "");
        break;
      case "rating":
        // A rating row carries either a min or a max; a combined item expands to
        // both wizard rows.
        if (item.min != null) push("min_rating", String(item.min));
        if (item.max != null) push("max_rating", String(item.max));
        if (item.min == null && item.max == null) push("max_rating", "");
        break;
      case "gender":
        push("gender", item.value ?? "");
        break;
      case "nationality":
        push("nationality", item.value ?? "");
        break;
    }
  }
  return rows;
}
