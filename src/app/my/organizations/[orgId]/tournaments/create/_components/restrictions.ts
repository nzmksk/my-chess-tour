// Bidirectional mapping between the wizard's per-row restriction UI (a label +
// free-text value, e.g. { type: "Max Age", value: "18" }) and the normalized
// shape that is stored in the DB and consumed by normalizeRestrictions /
// checkRestrictions at registration time (e.g. { type: "age", max: 18 }).
//
// Persisting the normalized shape is what makes wizard-created restrictions
// actually enforce — the UI labels are never stored. "state" and "custom" have
// no player-profile counterpart, so they're kept for display but not enforced.

export type PersistedRestriction =
  | { type: "age"; min?: number | null; max?: number | null }
  | { type: "rating"; min?: number | null; max?: number | null }
  | { type: "gender"; value: string }
  | { type: "nationality"; value: string }
  | { type: "state"; value: string }
  | { type: "custom"; value: string };

interface RestrictionRow {
  id: string;
  type: string;
  value: string;
}

function toNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Wizard rows → normalized restrictions for persistence. */
export function toPersistedRestrictions(
  rows: ReadonlyArray<{ type: string; value: string }>,
): PersistedRestriction[] {
  return rows.map((r) => {
    const value = r.value.trim();
    switch (r.type) {
      case "Max Age":
        return { type: "age", max: toNumberOrNull(value) };
      case "Min Rating":
        return { type: "rating", min: toNumberOrNull(value) };
      case "Max Rating":
        return { type: "rating", max: toNumberOrNull(value) };
      case "Gender":
        // checkRestrictions compares against the lowercase profile gender.
        return { type: "gender", value: value.toLowerCase() };
      case "Nationality":
        return { type: "nationality", value };
      case "State":
        return { type: "state", value };
      default:
        return { type: "custom", value };
    }
  });
}

/** Normalized restrictions (from the DB) → wizard rows for editing. */
export function fromPersistedRestrictions(
  items: ReadonlyArray<PersistedRestriction>,
): RestrictionRow[] {
  const rows: RestrictionRow[] = [];
  let idx = 0;
  const push = (type: string, value: string) =>
    rows.push({ id: `r-${idx++}`, type, value });

  for (const item of items) {
    switch (item.type) {
      case "age":
        push("Max Age", item.max != null ? String(item.max) : "");
        break;
      case "rating":
        // A rating row carries either a min or a max; a combined item expands to
        // both wizard rows.
        if (item.min != null) push("Min Rating", String(item.min));
        if (item.max != null) push("Max Rating", String(item.max));
        if (item.min == null && item.max == null) push("Max Rating", "");
        break;
      case "gender":
        push("Gender", item.value ?? "");
        break;
      case "nationality":
        push("Nationality", item.value ?? "");
        break;
      case "state":
        push("State", item.value ?? "");
        break;
      default:
        push("Custom", (item as { value?: string }).value ?? "");
        break;
    }
  }
  return rows;
}
