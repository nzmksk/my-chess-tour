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

// Lowest entry fee across the standard + additional tiers, ignoring missing or
// non-finite amounts (entry_fees is a jsonb column, so values aren't guaranteed
// numeric at runtime). Returns 0 when there are no valid amounts — callers render
// that as "Free". A genuine free tier (amount_cents === 0) is kept.
export function getMinFeeCents(fees: EntryFees | null | undefined): number {
  if (!fees) return 0;
  const amounts: number[] = [];
  const add = (n: unknown) => {
    if (typeof n === "number" && Number.isFinite(n)) amounts.push(n);
  };
  add(fees.standard?.amount_cents);
  for (const tier of fees.additional ?? []) add(tier.amount_cents);
  return amounts.length > 0 ? Math.min(...amounts) : 0;
}

export type TournamentDateState = "upcoming" | "ongoing" | "completed";

// Derives a tournament's temporal state from its calendar dates. The status
// column only tracks draft/published/cancelled; ongoing/completed are never
// stored — they're purely date-derived. `start_date`/`end_date` are Postgres
// `date` columns ("YYYY-MM-DD"), so lexicographic string comparison against
// `today` is chronological and timezone-safe.
//
// `today` must be the venue's today (getTodayInTimeZone(tournament.timezone)):
// a tournament is ongoing when it is ongoing where it is being played, not
// where the server or the reader happens to be.
export function getTournamentDateState(
  startDate: string,
  endDate: string,
  today: string,
): TournamentDateState {
  if (startDate > today) return "upcoming";
  if (endDate >= today) return "ongoing";
  return "completed";
}
