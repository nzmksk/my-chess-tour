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
    Date.UTC(date.getUTCFullYear() - years, date.getUTCMonth(), date.getUTCDate()),
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
  if (ageMax != null && dobDay < subtractYearsUTC(startDate, ageMax).getTime()) {
    return "too_old";
  }
  if (ageMin != null && dobDay > subtractYearsUTC(startDate, ageMin).getTime()) {
    return "too_young";
  }
  return null;
}

export function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

// Tournament dates/times are anchored to the venue's timezone. The platform is
// Malaysia-only today, so this defaults to KL; the `timeZone` param lets a
// per-tournament timezone drop in for the planned ASEAN expansion.
export const PLATFORM_TIME_ZONE = "Asia/Kuala_Lumpur";

// Returns the calendar date ("YYYY-MM-DD") for `now` in the given timezone.
// Used so the discovery ongoing/upcoming/past buckets are judged against the
// tournament's local "today" regardless of the server's runtime timezone.
export function getTodayInTimeZone(
  timeZone: string = PLATFORM_TIME_ZONE,
  now: Date = new Date(),
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export type TournamentDateState = "upcoming" | "ongoing" | "completed";

// Derives a tournament's temporal state from its calendar dates. The status
// column only tracks draft/published/cancelled; ongoing/completed are never
// stored — they're purely date-derived. `start_date`/`end_date` are Postgres
// `date` columns ("YYYY-MM-DD"), so lexicographic string comparison against
// `today` is chronological and timezone-safe.
export function getTournamentDateState(
  startDate: string,
  endDate: string,
  today: string = getTodayInTimeZone(),
): TournamentDateState {
  if (startDate > today) return "upcoming";
  if (endDate >= today) return "ongoing";
  return "completed";
}
