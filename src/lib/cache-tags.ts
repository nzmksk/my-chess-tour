// Shared Next.js cache tags for tournament pages. Read paths tag their data
// fetches with these; write paths (publish, update, payment settle) invalidate
// them via revalidateTag. Keeping the strings here prevents drift between the
// two sides — a mismatched tag would silently never invalidate.
//
// Note: all three write paths are Route Handlers (the Chip webhook is invoked
// externally), so they must use revalidateTag — Next 16's updateTag throws
// outside Server Actions and is intentionally not used here.

/** Tags the tournaments list fetch (and any page showing the list). */
export const TOURNAMENTS_LIST_TAG = "tournaments";

/** Tags a single tournament's detail fetch, keyed by its public slug. */
export const tournamentTag = (slug: string) => `tournament:${slug}`;

/**
 * Fallback revalidation window for tournament pages. Pages are served from
 * cache up to this long; freshness in practice comes from on-demand
 * revalidateTag calls on the write paths, not this timer.
 */
export const ONE_DAY_SECONDS = 86400;

/**
 * Profile passed as revalidateTag's required second argument (Next 16+).
 * "max" marks the tagged entries stale and serves stale-while-revalidate: the
 * next visitor still gets the cached data once while fresh data is fetched in
 * the background, so an edit shows on the visit after the first. We accept that
 * one-request lag rather than forcing a blocking cache-miss on every write.
 */
export const PURGE_PROFILE = "max";
