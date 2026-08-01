/**
 * Venue-timezone-aware date and time helpers.
 *
 * Tournament times belong to the venue, not the viewer: an organizer enters
 * them in the venue's local time and every viewer sees them in that same
 * timezone, wherever they are. Two kinds of value follow from that:
 *
 *   - **Calendar dates** — `start_date` / `end_date` are Postgres `date`
 *     columns: "YYYY-MM-DD" strings with no instant behind them. They are
 *     compared and formatted as strings here, so no runtime timezone can shift
 *     them a day (`new Date("2026-08-10")` is UTC midnight, which renders as
 *     the 9th for any viewer west of Greenwich).
 *   - **Instants** — `registration_deadline` and fee `valid_until` stay
 *     `timestamptz` (UTC on the wire) and are *displayed* in the venue's zone.
 *
 * Which zone that is comes from `tournaments.timezone`; the platform default
 * applies to anything that predates or omits it.
 */

export const DEFAULT_TIME_ZONE = "Asia/Kuala_Lumpur";

export interface VenueTimeZone {
  /** IANA name, as stored in `tournaments.timezone`. */
  id: string;
  /** What the organizer picks from in the wizard. */
  label: string;
  /** Short label shown beside a date, e.g. "10 Aug 2026 (MYT)". */
  abbreviation: string;
}

/**
 * The venue timezones an organizer may choose — ASEAN plus Timor-Leste, the
 * expansion region. Malaysia leads the list as the default. None of these zones
 * observe DST, but nothing here assumes that: offsets are always looked up
 * against a concrete instant.
 */
export const VENUE_TIME_ZONES: VenueTimeZone[] = [
  { id: "Asia/Kuala_Lumpur", label: "Malaysia", abbreviation: "MYT" },
  { id: "Asia/Brunei", label: "Brunei", abbreviation: "BNT" },
  { id: "Asia/Phnom_Penh", label: "Cambodia", abbreviation: "ICT" },
  { id: "Asia/Jakarta", label: "Indonesia — Western", abbreviation: "WIB" },
  { id: "Asia/Makassar", label: "Indonesia — Central", abbreviation: "WITA" },
  { id: "Asia/Jayapura", label: "Indonesia — Eastern", abbreviation: "WIT" },
  { id: "Asia/Vientiane", label: "Laos", abbreviation: "ICT" },
  { id: "Asia/Yangon", label: "Myanmar", abbreviation: "MMT" },
  { id: "Asia/Manila", label: "Philippines", abbreviation: "PHT" },
  { id: "Asia/Singapore", label: "Singapore", abbreviation: "SGT" },
  { id: "Asia/Bangkok", label: "Thailand", abbreviation: "ICT" },
  { id: "Asia/Dili", label: "Timor-Leste", abbreviation: "TLT" },
  { id: "Asia/Ho_Chi_Minh", label: "Vietnam", abbreviation: "ICT" },
];

const VENUE_TIME_ZONES_BY_ID = new Map(VENUE_TIME_ZONES.map((z) => [z.id, z]));

export function isSupportedTimeZone(value: unknown): value is string {
  return typeof value === "string" && VENUE_TIME_ZONES_BY_ID.has(value);
}

/**
 * The timezone to treat a tournament's dates as being in. Anything unknown —
 * a NULL column, a zone dropped from the picklist — falls back to the platform
 * default rather than throwing inside `Intl`, which would take a page down.
 */
export function resolveTimeZone(value: string | null | undefined): string {
  return isSupportedTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}

/**
 * Short zone label for display ("MYT"). Zones outside the picklist fall back to
 * whatever `Intl` calls them, which is a GMT offset ("GMT+8") — still true, just
 * less friendly.
 */
export function timeZoneAbbreviation(timeZone: string): string {
  const known = VENUE_TIME_ZONES_BY_ID.get(timeZone);
  if (known) return known.abbreviation;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/**
 * The calendar date ("YYYY-MM-DD") `now` falls on in `timeZone`. Discovery's
 * ongoing/upcoming/past buckets are judged against this, so a tournament's
 * state is its venue's — not the server's, and not the viewer's.
 */
export function getTodayInTimeZone(
  timeZone: string = DEFAULT_TIME_ZONE,
  now: Date = new Date(),
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The UTC offset ("+08:00") that `timeZone` was on at `date`. */
export function utcOffsetInTimeZone(timeZone: string, date: Date): string {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return "+00:00";
  const [, sign, hours, minutes = "00"] = match;
  return `${sign}${hours.padStart(2, "0")}:${minutes}`;
}

/**
 * A wall-clock time the organizer typed ("2026-02-19T18:00", as an
 * `<input type="datetime-local">` produces) → the instant it names in the
 * venue's timezone ("2026-02-19T18:00:00+08:00").
 *
 * Without the offset the string reaches Postgres bare and is read in the
 * database's zone, so a 6pm KL deadline would be stored as 6pm UTC — eight
 * hours late.
 */
export function toInstantInTimeZone(
  localDateTime: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const [datePart, timePart = "00:00"] = localDateTime.split("T");
  const time = timePart.length === 5 ? `${timePart}:00` : timePart;
  // Seeded with the offset that applies at the same wall-clock read as UTC,
  // then re-read at the resulting instant: in a DST zone the two can differ,
  // and the second lookup is the one that lands on the right side of the shift.
  const approx = new Date(`${datePart}T${time}Z`);
  if (Number.isNaN(approx.getTime())) return localDateTime;
  const firstPass = utcOffsetInTimeZone(timeZone, approx);
  const offset = utcOffsetInTimeZone(
    timeZone,
    new Date(`${datePart}T${time}${firstPass}`),
  );
  return `${datePart}T${time}${offset}`;
}

/**
 * An instant → the "YYYY-MM-DDTHH:mm" an `<input type="datetime-local">` shows,
 * read in the venue's timezone so the organizer edits the same wall-clock time
 * they entered. Returns "" for anything unparseable rather than a broken input.
 */
export function toLocalDateTimeInput(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(parsed);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // en-CA renders midnight as "24" in some runtimes; the input wants "00".
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** An instant → the calendar date ("YYYY-MM-DD") it falls on in `timeZone`. */
export function toCalendarDateInTimeZone(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return getTodayInTimeZone(timeZone, parsed);
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// A "YYYY-MM-DD" string as a UTC instant. Formatting it back with
// `timeZone: "UTC"` is what keeps a calendar date on its own day for every
// viewer — the venue's timezone names the day, it doesn't move it.
function calendarDateAsUtc(date: string): Date | null {
  if (!DATE_ONLY_RE.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Days added to (or subtracted from) a calendar date, as a calendar date. */
export function addCalendarDays(date: string, days: number): string {
  const parsed = calendarDateAsUtc(date);
  if (!parsed) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** First calendar date of the month `date` falls in, `monthOffset` months on. */
export function startOfMonth(date: string, monthOffset = 0): string {
  const parsed = calendarDateAsUtc(date);
  if (!parsed) return date;
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + monthOffset, 1),
  )
    .toISOString()
    .slice(0, 10);
}

/** Last calendar date of the month `date` falls in, `monthOffset` months on. */
export function endOfMonth(date: string, monthOffset = 0): string {
  const parsed = calendarDateAsUtc(date);
  if (!parsed) return date;
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth() + monthOffset + 1,
      0,
    ),
  )
    .toISOString()
    .slice(0, 10);
}

const DAY_MONTH_YEAR: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

/**
 * A calendar date → "10 Aug 2026". Formatted at UTC from the date's own parts,
 * so it reads the same on a server in UTC and a browser in São Paulo.
 */
export function formatCalendarDate(date: string): string {
  const parsed = calendarDateAsUtc(date);
  if (!parsed) return date;
  return parsed.toLocaleDateString("en-MY", {
    ...DAY_MONTH_YEAR,
    timeZone: "UTC",
  });
}

/**
 * A tournament's date range → "10 Aug 2026" or "10 – 12 Aug 2026", with the
 * venue's zone named ("(MYT)") when one is given, since the dates are that
 * venue's local days rather than the reader's.
 */
export function formatCalendarDateRange(
  start: string,
  end: string,
  timeZone?: string,
): string {
  const suffix = timeZone ? ` (${timeZoneAbbreviation(timeZone)})` : "";
  const startParsed = calendarDateAsUtc(start);
  const endParsed = calendarDateAsUtc(end);
  if (!startParsed || !endParsed) return `${start} – ${end}`;
  if (start === end) return `${formatCalendarDate(start)}${suffix}`;
  const startLabel = startParsed.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `${startLabel} – ${formatCalendarDate(end)}${suffix}`;
}

/**
 * An instant → the day it falls on in the venue's timezone, e.g.
 * "19 Feb 2026 (MYT)". Deadlines are stored as instants but read as days, and
 * which day that is depends on the zone you read it in.
 */
export function formatInstantDate(
  iso: string,
  timeZone: string = DEFAULT_TIME_ZONE,
  { withZone = true }: { withZone?: boolean } = {},
): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const label = parsed.toLocaleDateString("en-MY", {
    ...DAY_MONTH_YEAR,
    timeZone,
  });
  return withZone ? `${label} (${timeZoneAbbreviation(timeZone)})` : label;
}
