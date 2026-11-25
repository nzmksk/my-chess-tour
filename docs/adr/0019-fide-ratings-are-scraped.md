# 0019. FIDE ratings are scraped from profile pages

- Status: Accepted; the name check's effect superseded by [0028](0028-a-fide-id-must-carry-the-players-name.md)
- Date: 2026-11-21
- Issue: #675

## Context

Players enter a FIDE ID, and tournaments seed and restrict by FIDE rating.
FIDE publishes no official API.

## Decision

`src/services/fide/fide.ts` reads `https://ratings.fide.com/profile/<id>`, the
server-rendered page carrying the name, the standard, rapid and blitz ratings
and the title, with a browser-like client. All coupling to FIDE's markup lives
in this one module, so a FIDE redesign is a one-file fix. The monthly
`players_list.zip` is the fallback if scraping ever gets too heavy.

- The id comes from the caller and goes into the URL, so it's validated here
  as a positive `int4`.
- A page without the player-title header is FIDE's not-found shell, and
  returns `null`. A network failure or an unexpected status **throws**, so
  callers can tell a mistyped id from FIDE being down.
- Unrated categories render as `0` or blank and become `null`. FIDE's title
  text maps onto the `chess_title` enum; Arena titles and "None" stay unset,
  and a missing title never overwrites one already stored (an admin may have
  entered it).
- The name check is lenient: the stored first and last names must both appear
  in FIDE's "Last, First" name, in any order, ignoring diacritics and extra
  middle names.
- `syncFidePlayer` is shared by the on-save `PATCH /profile` route and the
  monthly cron, so the two can't drift. It's best-effort: it logs and returns
  `"failed"` so a batch continues past one bad player.

## Consequences

- A FIDE markup change breaks lookups until this module is updated; the
  fixture in `fide.test.ts` mirrors the markup it depends on.
