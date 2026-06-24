export function calculateAge(dob: Date, now: Date): number {
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatRm(cents: number): string {
  if (cents === 0) return "Free";
  return `RM${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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

// Tournament dates/times are anchored to the venue's timezone. The platform is
// Malaysia-only today, so this defaults to KL; the `timeZone` param lets a
// per-tournament timezone drop in for the planned ASEAN expansion.
const PLATFORM_TIME_ZONE = "Asia/Kuala_Lumpur";

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
