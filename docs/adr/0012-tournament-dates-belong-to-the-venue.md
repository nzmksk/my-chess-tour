# 0012. Tournament dates belong to the venue

- Status: Accepted
- Date: 2026-11-21
- Issue: #675

## Context

The platform is expanding across ASEAN, whose zones run from UTC+6:30
(Yangon) to UTC+9 (Jayapura). A tournament's times are set by its organizer
for the place it's played, and every viewer, wherever they are, needs to see
the same days. `new Date("2026-08-10")` is UTC midnight, which renders as the
9th for any viewer west of Greenwich, and a bare `datetime-local` value sent
to Postgres is read in the database's zone, so a 6pm Kuala Lumpur deadline
would be stored eight hours late.

## Decision

`src/lib/tournaments/datetime.ts` and `src/lib/tournaments/venues.ts`.

**Two kinds of value.**

- _Calendar dates_ (`start_date`, `end_date`) are Postgres `date` columns,
  `YYYY-MM-DD` with no instant behind them. They're compared as strings
  (lexicographic order is chronological) and formatted at UTC from their own
  parts, so no runtime zone can shift them. The venue's zone names the day; it
  doesn't move it.
- _Instants_ (`registration_deadline`, fee `valid_until`) are `timestamptz`,
  UTC on the wire, displayed in the venue's zone. What the organizer types is
  given the venue's offset before it's sent (`toInstantInTimeZone`), with the offset
  re-read at the resulting instant so a DST shift lands on the right side; and
  shown back in the venue's zone so they edit the time they entered.

**Today is the venue's today.** `getTodayInTimeZone(tournament.timezone)`
decides whether a tournament is upcoming, ongoing or past, and whether a start
date is still in the future. `ongoing` and `completed` are never stored; they
derive from the dates (`getTournamentDateState`).

**The zone comes from the region.** Each venue region in `SUPPORTED_COUNTRIES`
carries its IANA zone, and the zone is written to `tournaments.timezone` on
save. The organizer used to pick it from a separate list, which let a venue be
stated as Singapore, countried as Malaysia and clocked in Bangkok. It's
per-region, not per-country, because a country can span zones (Indonesia's
WIB, WITA and WIT). Malaysia is one zone throughout.

**Venue country stays its own column**: it decides the payout rails and
currency, which no zone can answer. It's separate from
`src/lib/reference/countries.ts`, which is player _nationality_, a different
question.

**Unknowns fall back, never throw.** `resolveTimeZone` and `timeZoneForRegion`
return the platform default (`Asia/Kuala_Lumpur`) for a NULL or unknown zone,
country or region, because a zone `Intl` can't parse takes down every page
that formats a date. Write paths still validate the region (`isValidRegion`),
so the fallback is a safety net, not how a bad region gets accepted. The venue
helpers take `unknown`, because their callers hold parsed JSON, where
`{"venue_country": 123}` is valid and would otherwise throw on
`.toUpperCase()` and turn a bad request into a 500.

**Registration closes at `registration_closed_at`**
(`src/lib/tournaments/registration-status.ts`). Publishing stamps it with the
deadline, and closing early only moves it earlier. Drafts have it NULL, so
callers pass the deadline as the fallback. "Closed early" is
`closed_at < deadline`, never "is it non-null?".

## Consequences

- None of the picklist zones observe DST, but nothing assumes it: offsets are
  always looked up against a concrete instant.
- See [api-design](../../wiki/api-design.md) for the wire
  format, and [tournament-editing](../../wiki/tournament-editing.md) for how
  the stages use the venue's today.
