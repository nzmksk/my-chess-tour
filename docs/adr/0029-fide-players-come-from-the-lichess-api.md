# 0029. FIDE players come from the Lichess API

- Status: Accepted; supersedes [0019](0019-fide-ratings-are-scraped.md)
- Date: 2026-11-25
- Issue: #767

## Context

[ADR 0019](0019-fide-ratings-are-scraped.md) read each player's
`ratings.fide.com/profile/<id>` page. From Netlify's functions that host can't
be reached at all: the TCP connect times out after 10 s
(`UND_ERR_CONNECT_TIMEOUT`), while the same request from a home connection
answers in about a second. FIDE most likely drops traffic from cloud-hosting
ranges. Once [ADR 0028](0028-a-fide-id-must-carry-the-players-name.md) made a
new FIDE ID wait for a successful lookup, every attempt to set one on staging
failed with 503 `FIDE_UNAVAILABLE`. The monthly `cron/fide-ratings` job runs on
Netlify too, so it can't reach FIDE either. A retry or a longer timeout doesn't
help when the connection is refused.

## Decision

`fetchFidePlayer` in `src/services/fide/fide.ts` calls Lichess's public, keyless
`GET https://lichess.org/api/fide/player/{id}`, which serves FIDE's monthly
rating list as JSON. There's no fallback to ratings.fide.com: it doesn't work
from where the app runs.

- `LichessFidePlayer` mirrors Lichess's `FIDEPlayer` schema. `id`, `name` and
  `federation` are always present. `title`, `year`, `inactive`, `standard`,
  `rapid`, `blitz` and `gender` are left out when they don't apply.
- An absent or non-positive rating becomes `null`. A title outside the
  `chess_title` enum (Lichess also sends NM, WNM, LM and BOT) is ignored.
- A 404 or a blank name returns `null`, which means "no such FIDE ID". Any
  other status, a network error, an 8 s timeout or a body without a `name`
  **throws**, so callers still tell a mistyped ID apart from the source being
  down, as before.
- The name is FIDE's "Last, First" string, unchanged, so `matchesFideName` and
  the ADR 0028 rule keep working as they are.
- Lichess asks clients to make one request at a time. The cron looks players up
  one by one, with a 200 ms pause between them, instead of four at a time.

## Consequences

- No more HTML scraping, so a FIDE redesign no longer breaks lookups. A
  breaking change to Lichess's API would, and so would Lichess being down,
  which blocks setting a new FIDE ID until it's back.
- The data is FIDE's monthly list, so a rating can be up to a month behind the
  live FIDE page. The cron already syncs monthly, so nothing gets staler than
  before.
- The sequential cron fits fewer players into its 300 s window, roughly 1,000
  at Lichess's normal response time. Past that it needs paging across runs.
- On a 429 the rest of that run's lookups also fail, and those players wait for
  the next monthly run.
- Public profile and starting-rank links still point at ratings.fide.com.
  Those are opened by the player's browser, not by our servers.
