// Bidirectional mapping between the wizard's fee-tier rows and the canonical
// `tournaments.entry_fees` JSON.
//
// The canonical shape is the one every consumer already reads — the schema
// comment in db/migrations/001_tables.sql, the seed, EntryFees in
// src/app/tournaments/types.ts, the public detail page, RegisterForm, checkout
// and the registration eligibility validators: bounds are `age_min`/`age_max`
// and `valid_until` is a full timestamp.
//
// The wizard used to write its own dialect (`age_from`/`age_to`,
// `rating_from`/`rating_to`, a date-only `valid_until`), which meant resuming a
// draft it had not written itself showed empty criteria (#478) — and, worse,
// that wizard-written age bounds were invisible to the tier eligibility check
// at registration time. Going through this module is what keeps the two
// directions from drifting apart again.

import {
  DEFAULT_TIME_ZONE,
  toCalendarDateInTimeZone,
  utcOffsetInTimeZone,
} from "@/lib/datetime";
import type {
  FeesData,
  FeeTier,
  PersistedEntryFees,
  PersistedFeeTier,
  StoredEntryFees,
  TierType,
} from "../types";

/** The tiers the wizard can edit, in the order its "Add Fee Tier" menu lists them. */
export const TIER_TYPES: TierType[] = [
  "early_bird",
  "titled_players",
  "rating_based",
  "age_based",
];

export const TIER_LABELS: Record<TierType, string> = {
  early_bird: "Early Bird",
  titled_players: "Titled Players",
  rating_based: "Rating-Based",
  age_based: "Age-Based",
};

const EDITABLE_TIER_TYPES = new Set<string>(TIER_TYPES);

function toCents(amount: number | ""): number {
  return amount === "" ? 0 : Math.round(Number(amount) * 100);
}

function fromCents(cents: number | null | undefined): number | "" {
  return typeof cents === "number" && Number.isFinite(cents) ? cents / 100 : "";
}

function boundOrUndefined(value: number | ""): number | undefined {
  return value === "" ? undefined : Number(value);
}

function boundOrEmpty(value: number | null | undefined): number | "" {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

/**
 * A wizard date ("2026-02-19") → the instant that day ends in the venue's
 * timezone ("2026-02-19T23:59:59+08:00").
 *
 * Consumers treat `valid_until` as an instant (`new Date(valid_until) < now`),
 * so storing the bare date would expire the tier at 08:00 local on the very day
 * the UI promises is still included ("register on or before this date").
 */
export function toValidUntilTimestamp(
  date: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  // Midday UTC is inside `date` in every real timezone, so the offset looked up
  // for it is the offset that applies to that calendar day.
  const offset = utcOffsetInTimeZone(timeZone, new Date(`${date}T12:00:00Z`));
  return `${date}T23:59:59${offset}`;
}

/**
 * A stored `valid_until` → the "YYYY-MM-DD" an `<input type="date">` can show,
 * reduced to its calendar date in the venue's timezone. Nothing constrains the
 * column, so an unparseable value yields "" rather than a broken input.
 */
export function fromValidUntilTimestamp(
  value: string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return toCalendarDateInTimeZone(value, timeZone);
}

/**
 * Wizard fee state → canonical entry_fees for persistence. `timeZone` is the
 * venue's: an early-bird tier the organizer says runs "until the 19th" ends
 * when the 19th ends at the venue.
 */
export function toPersistedEntryFees(
  data: FeesData,
  timeZone: string = DEFAULT_TIME_ZONE,
): PersistedEntryFees {
  return {
    standard: { amount_cents: toCents(data.standardFee) },
    additional: data.tiers.map((tier) => {
      const persisted: PersistedFeeTier = {
        type: tier.type,
        amount_cents: toCents(tier.amount),
      };

      switch (tier.type) {
        case "early_bird":
          if (tier.validUntil) {
            persisted.valid_until = toValidUntilTimestamp(
              tier.validUntil,
              timeZone,
            );
          }
          break;
        case "titled_players":
          if (tier.titles.length > 0) persisted.titles = tier.titles;
          break;
        case "rating_based": {
          const min = boundOrUndefined(tier.ratingFrom);
          const max = boundOrUndefined(tier.ratingTo);
          if (min !== undefined) persisted.rating_min = min;
          if (max !== undefined) persisted.rating_max = max;
          break;
        }
        case "age_based": {
          const min = boundOrUndefined(tier.ageFrom);
          const max = boundOrUndefined(tier.ageTo);
          if (min !== undefined) persisted.age_min = min;
          if (max !== undefined) persisted.age_max = max;
          break;
        }
      }

      return persisted;
    }),
  };
}

/**
 * Canonical entry_fees (from the DB) → wizard fee state for editing.
 *
 * Tiers the wizard has no editor for (the canonical gender/oku tiers, or the
 * implicit "standard" entry some rows carry) are skipped rather than coerced
 * into an early-bird row — an unrecognised tier is not editable here and must
 * not be silently rewritten as a different one.
 */
export function fromPersistedEntryFees(
  fees: StoredEntryFees | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): FeesData {
  const tiers: FeeTier[] = [];

  for (const stored of fees?.additional ?? []) {
    if (!EDITABLE_TIER_TYPES.has(stored.type)) continue;

    tiers.push({
      type: stored.type as TierType,
      amount: fromCents(stored.amount_cents),
      validUntil: fromValidUntilTimestamp(stored.valid_until, timeZone),
      titles: stored.titles ?? [],
      ratingFrom: boundOrEmpty(stored.rating_min),
      ratingTo: boundOrEmpty(stored.rating_max),
      ageFrom: boundOrEmpty(stored.age_min),
      ageTo: boundOrEmpty(stored.age_max),
    });
  }

  return {
    standardFee: fromCents(fees?.standard?.amount_cents),
    tiers,
  };
}
