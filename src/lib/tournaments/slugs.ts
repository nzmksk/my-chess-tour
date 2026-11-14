/**
 * URL slug helpers.
 *
 * Generic and side-effect free so they can back any slugged entity (tournaments
 * today, organization discovery later). `ensureUniqueSlug` takes an `exists`
 * probe so the caller owns the uniqueness lookup (table, scope, exclusions).
 */

const MAX_SLUG_LENGTH = 50;
const FALLBACK_SLUG = "tournament";

// Combining diacritical marks (U+0300–U+036F), left behind by NFKD decomposition
// of accented characters (e.g. "é" -> "e" + U+0301).
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Turns arbitrary text into a URL-safe slug: lowercased, diacritics stripped,
 * every run of non-alphanumerics collapsed to a single hyphen, trimmed, and
 * capped at {@link MAX_SLUG_LENGTH}. Falls back to {@link FALLBACK_SLUG} when the
 * input has no usable characters (e.g. only punctuation or non-Latin script).
 */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, ""); // re-trim in case the slice ended on a hyphen

  return slug || FALLBACK_SLUG;
}

/**
 * Returns `base` if it's free, otherwise `base-2`, `base-3`, … until `exists`
 * reports the candidate is available. `exists` should return true when a row
 * already uses the candidate slug.
 */
export async function ensureUniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(base))) return base;

  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
}
