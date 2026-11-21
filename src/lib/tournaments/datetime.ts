export const DEFAULT_TIME_ZONE = "Asia/Kuala_Lumpur";

export interface VenueTimeZone {
  id: string;
  label: string;
  abbreviation: string;
}

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

export function resolveTimeZone(value: string | null | undefined): string {
  return isSupportedTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}

export function timeZoneAbbreviation(timeZone: string): string {
  const known = VENUE_TIME_ZONES_BY_ID.get(timeZone);
  if (known) return known.abbreviation;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

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

export function toInstantInTimeZone(
  localDateTime: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const [datePart, timePart = "00:00"] = localDateTime.split("T");
  const time = timePart.length === 5 ? `${timePart}:00` : timePart;
  const approx = new Date(`${datePart}T${time}Z`);
  if (Number.isNaN(approx.getTime())) return localDateTime;
  const firstPass = utcOffsetInTimeZone(timeZone, approx);
  const offset = utcOffsetInTimeZone(
    timeZone,
    new Date(`${datePart}T${time}${firstPass}`),
  );
  return `${datePart}T${time}${offset}`;
}

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
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

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

function calendarDateAsUtc(date: string): Date | null {
  if (!DATE_ONLY_RE.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function addCalendarDays(date: string, days: number): string {
  const parsed = calendarDateAsUtc(date);
  if (!parsed) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function startOfMonth(date: string, monthOffset = 0): string {
  const parsed = calendarDateAsUtc(date);
  if (!parsed) return date;
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + monthOffset, 1),
  )
    .toISOString()
    .slice(0, 10);
}

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

export function formatCalendarDate(
  date: string,
  options: Intl.DateTimeFormatOptions = DAY_MONTH_YEAR,
): string {
  const parsed = calendarDateAsUtc(date);
  if (!parsed) return date;
  return parsed.toLocaleDateString("en-MY", { ...options, timeZone: "UTC" });
}

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

export type TournamentDateState = "upcoming" | "ongoing" | "completed";

export function getTournamentDateState(
  startDate: string,
  endDate: string,
  today: string,
): TournamentDateState {
  if (startDate > today) return "upcoming";
  if (endDate >= today) return "ongoing";
  return "completed";
}
