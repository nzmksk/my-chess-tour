import type { EntryFees } from "./types";

export function calculateAge(dob: Date, now: Date): number {
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function subtractYearsUTC(date: Date, years: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear() - years,
      date.getUTCMonth(),
      date.getUTCDate(),
    ),
  );
}

export type AgeEligibility = "too_young" | "too_old" | null;

// Age eligibility for tournament categories / fee tiers is judged as of the
// tournament's START DATE with day precision (FIDE-style, but anchored to the
// start date rather than Jan 1): a player is eligible for an "under ageMax" cap
// only if they have NOT reached ageMax before the start date, i.e.
//   DOB >= start_date - ageMax years.
// Symmetrically, ageMin requires the player to have reached ageMin by the start
// date: DOB <= start_date - ageMin years.
//
// Example — event starting 2026-07-01 with ageMax 12: born 2014-07-01 (turns 12
// exactly on the start day) is eligible; born 2014-06-30 (12y 0m 1d) is not.
// This is stricter than completed-whole-years age, so it can't reuse
// calculateAge(). Both `date_of_birth` and `start_date` are Postgres `date`
// columns (parsed at UTC midnight), so the comparison is a pure calendar-date
// one, independent of the runtime timezone.
export function checkAgeEligibility(
  dob: Date,
  startDate: Date,
  ageMin: number | null,
  ageMax: number | null,
): AgeEligibility {
  const dobDay = Date.UTC(
    dob.getUTCFullYear(),
    dob.getUTCMonth(),
    dob.getUTCDate(),
  );
  if (
    ageMax != null &&
    dobDay < subtractYearsUTC(startDate, ageMax).getTime()
  ) {
    return "too_old";
  }
  if (
    ageMin != null &&
    dobDay > subtractYearsUTC(startDate, ageMin).getTime()
  ) {
    return "too_young";
  }
  return null;
}

/** The subset of a player profile eligibility checks judge a rating from. */
export interface RatedProfile {
  fide_rating?: Record<string, number> | null;
  national_rating?: number | null;
}

/** Which rating list an eligibility check judges a player against. */
export interface RatingContext {
  /** The tournament's format type — "classical" | "rapid" | "blitz". */
  formatType: string;
  isFideRated: boolean;
  isMcfRated: boolean;
}

/** The FIDE rating list a tournament format is played under. */
function ratingListForFormat(
  formatType: string,
): "standard" | "rapid" | "blitz" {
  return formatType === "blitz"
    ? "blitz"
    : formatType === "rapid"
      ? "rapid"
      : "standard";
}

/**
 * Names the rating a check reads, for messages telling a player which rating
 * they're missing — e.g. "FIDE standard", "national (MCF)".
 */
export function describeRatingList({
  formatType,
  isFideRated,
  isMcfRated,
}: RatingContext): string {
  if (isFideRated) return `FIDE ${ratingListForFormat(formatType)}`;
  if (isMcfRated) return "national (MCF)";
  return `FIDE ${ratingListForFormat(formatType)} or national`;
}

function numericOrNull(value: unknown): number | null {
  // Both sources are jsonb-backed, so a non-numeric value is treated as absent
  // rather than compared as a string.
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// The rating a player is judged on, taken from the list the tournament is
// actually rated under — never substituted from another one:
//
//   FIDE-rated → the FIDE list matching the format (classical → standard).
//   MCF-rated  → the national rating.
//
// A player without a rating on that list is unrated for this tournament, even if
// they hold one elsewhere: a classical FIDE event can't rank a player by their
// blitz or national rating. An event rated by neither federation has no list of
// its own to insist on, so it accepts whichever rating the player has (FIDE for
// the format first, then national) — that's the only case where both are read.
export function resolvePlayerRating(
  profile: RatedProfile | null | undefined,
  { formatType, isFideRated, isMcfRated }: RatingContext,
): number | null {
  const fide = numericOrNull(
    profile?.fide_rating?.[ratingListForFormat(formatType)],
  );
  const national = numericOrNull(profile?.national_rating);

  if (isFideRated) return fide;
  if (isMcfRated) return national;
  return fide ?? national;
}

export type RatingEligibility = "below_min" | "above_max" | null;

// Rating eligibility for a fee tier or a tournament restriction. An unrated
// player cannot show they clear a floor, so a `min` blocks them; a `max` (an
// "under 1800" tier) still admits them — unrated players are exactly who those
// categories are for.
export function checkRatingEligibility(
  rating: number | null,
  ratingMin: number | null,
  ratingMax: number | null,
): RatingEligibility {
  if (ratingMin != null && (rating == null || rating < ratingMin))
    return "below_min";
  if (ratingMax != null && rating != null && rating > ratingMax)
    return "above_max";
  return null;
}

// Display RM formatting for tournament listings: renders a zero fee as "Free"
// and otherwise always shows two decimal places so cents are never truncated
// (e.g. RM0.10 stays "RM0.10", not "RM0"). See #359.
export function formatRm(cents: number): string {
  if (cents === 0) return "Free";
  return formatRmExact(cents);
}

// Exact (sen-precision) RM formatting for checkout/payment summaries where the
// displayed amount must match what the player is actually charged. Always
// numeric (e.g. "RM0.00") — callers decide whether to show "Free" for a zero total.
export function formatRmExact(cents: number): string {
  return `RM${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function toTitleCase(s: string): string {
  return s.replace(/[_\s]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type FeeTier = NonNullable<EntryFees["additional"]>[number];

/** One row of a tournament's fee schedule: the standard fee or an additional tier. */
export interface FeeRow {
  type: string;
  amount_cents: number;
  /** The additional tier this row is, or null for the standard fee. */
  tier: FeeTier | null;
  /** Its valid_until has passed, so nobody can register at it any more. */
  expired: boolean;
  /** Only some players qualify for it (age, rating, gender, OKU or title). */
  restricted: boolean;
}

/** Whether a tier is open only to players who meet a condition. */
export function isRestrictedTier(tier: FeeTier): boolean {
  return (
    tier.age_min != null ||
    tier.age_max != null ||
    tier.rating_min != null ||
    tier.rating_max != null ||
    tier.gender != null ||
    tier.oku === true ||
    (tier.titles?.length ?? 0) > 0
  );
}

/**
 * The fee schedule as players should read it: tiers still open first, cheapest
 * to dearest, then any that have ended (also by price), since an ended tier is
 * no longer an option. Same order the register form offers them in. Rows with
 * a missing or non-numeric amount are dropped (entry_fees is jsonb). Ties keep
 * the organizer's order, with the standard fee after the tiers.
 */
export function listFeeRows(
  fees: EntryFees | null | undefined,
  now: Date,
): FeeRow[] {
  if (!fees) return [];
  const valid = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n);

  const rows: FeeRow[] = [];
  for (const tier of fees.additional ?? []) {
    if (!valid(tier.amount_cents)) continue;
    rows.push({
      type: tier.type,
      amount_cents: tier.amount_cents,
      tier,
      expired: !!tier.valid_until && new Date(tier.valid_until) <= now,
      restricted: isRestrictedTier(tier),
    });
  }
  if (valid(fees.standard?.amount_cents)) {
    rows.push({
      type: "standard",
      amount_cents: fees.standard.amount_cents,
      tier: null,
      expired: false,
      restricted: false,
    });
  }

  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        Number(a.row.expired) - Number(b.row.expired) ||
        a.row.amount_cents - b.row.amount_cents ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}

export interface StartingFee {
  /** What anyone can register at right now; 0 renders as "Free". */
  amount_cents: number;
  /** The row that price comes from, or null when there are no valid fees. */
  row: FeeRow | null;
  /**
   * The cheapest open tier below that price that only some players qualify for
   * (e.g. "Age 0–12"), worth pointing out without leading with it.
   */
  cheaperRestricted: FeeRow | null;
}

/**
 * The "starting from" price: the lowest fee anyone can still register at now.
 * Ended tiers don't count, and neither do tiers only some players qualify for,
 * since leading with an under-12 price misleads everyone else (#258). Those
 * cheaper restricted tiers are reported separately.
 */
export function getStartingFee(
  fees: EntryFees | null | undefined,
  now: Date,
): StartingFee {
  const open = listFeeRows(fees, now).filter((row) => !row.expired);
  const row = open.find((r) => !r.restricted) ?? null;
  const amount = row?.amount_cents ?? 0;
  const cheaperRestricted =
    row === null
      ? null
      : (open.find((r) => r.restricted && r.amount_cents < amount) ?? null);
  return { amount_cents: amount, row, cheaperRestricted };
}

// Moved to src/lib so lib code (the edit policy) can use it; re-exported here
// for the pages that already import it from this module.
export { getTournamentDateState } from "@/lib/tournaments/datetime";
