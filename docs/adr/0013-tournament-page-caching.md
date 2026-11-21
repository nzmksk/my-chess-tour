# 0013. Tournament pages are cached and purged by tag

- Status: Accepted
- Date: 2026-11-21
- Issue: #675

## Context

The tournament list and detail pages are read far more than they change.
Their data changes on a handful of write paths: publish, update, and payment
settlement (which moves the seats-left count).

## Decision

Read paths tag their fetches with `TOURNAMENTS_LIST_TAG` or
`tournamentTag(slug)` from `src/lib/tournaments/cache-tags.ts`, and the write
paths purge those tags. The strings live in one module because a mismatched
tag silently never invalidates.

- The write paths are Route Handlers (the CHIP webhook is called from
  outside), so they use `revalidateTag`. Next 16's `updateTag` throws outside
  Server Actions.
- `revalidateTag` takes `PURGE_PROFILE` (`"max"`) as its required second
  argument: entries are marked stale and served stale-while-revalidate, so the
  next visitor gets the cached page once while fresh data loads, and an edit
  shows on the visit after that. We accept that one-request lag over forcing a
  blocking cache miss on every write.
- Pages fall back to a one-day revalidation window. Freshness comes from the
  tag purges, not this timer. `export const revalidate` must be a literal,
  because Next analyses it statically, so pages write `86400` and
  `ONE_DAY_SECONDS` holds the same value for code that can use a constant.

## Consequences

- A new write path that changes what a tournament page shows must purge the
  matching tag.
