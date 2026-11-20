import type { CaptureResult } from "posthog-js";

/**
 * Query parameters that may reach PostHog. Everything else is dropped, because
 * a URL can carry secrets the analytics project has no business holding: auth
 * codes and token hashes, `redirectTo`/`next` targets, error messages, and
 * free-text search. An allowlist fails safe when a new parameter is added.
 */
const ALLOWED_QUERY_PARAMS = new Set([
  "tab",
  "status",
  "sort",
  "order",
  "page",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
]);

/**
 * Path segments that are bearer secrets. Opening `/invitations/<token>` is
 * enough to accept an organization invitation as whoever is signed in, so the
 * token must never be stored in an analytics URL.
 */
const SECRET_PATH_SEGMENTS: ReadonlyArray<[RegExp, string]> = [
  [/^\/invitations\/[^/]+/, "/invitations/:token"],
];

/** Event properties that hold this site's own URLs or paths. */
const URL_PROPERTIES = [
  "$current_url",
  "$initial_current_url",
  "$pathname",
  "$initial_pathname",
  "$prev_pageview_pathname",
  "$prev_pageview_url",
];

/** Event properties that hold the referring page, which may be another site. */
const REFERRER_PROPERTIES = ["$referrer", "$initial_referrer"];

// Only used to parse bare paths such as `$pathname`; never part of the output.
const PARSE_BASE = "http://path.invalid";

function scrubPath(pathname: string): string {
  for (const [pattern, replacement] of SECRET_PATH_SEGMENTS) {
    if (pattern.test(pathname)) return pathname.replace(pattern, replacement);
  }
  return pathname;
}

/**
 * Remove anything secret from one of this site's URLs (absolute, or a bare
 * path). The fragment always goes: Supabase puts session tokens there on
 * recovery and magic-link redirects. Values that are not URLs (e.g.
 * PostHog's `$direct`) are returned unchanged.
 */
export function scrubUrl(value: string): string {
  const isPath = value.startsWith("/");
  let url: URL;
  try {
    url = new URL(value, isPath ? PARSE_BASE : undefined);
  } catch {
    return value;
  }

  url.hash = "";
  url.pathname = scrubPath(url.pathname);
  for (const key of [...url.searchParams.keys()]) {
    if (!ALLOWED_QUERY_PARAMS.has(key)) url.searchParams.delete(key);
  }

  const scrubbed = url.toString();
  return isPath ? scrubbed.slice(PARSE_BASE.length) : scrubbed;
}

/**
 * A referrer from this site gets the same treatment as any of its URLs. A
 * referrer from another site is cut down to its origin: the path of, say, a
 * payment gateway page identifies a specific purchase, and the origin is all
 * the referral reports need.
 */
export function scrubReferrer(value: string, siteOrigin: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  return url.origin === siteOrigin ? scrubUrl(value) : `${url.origin}/`;
}

function scrubProperties(
  properties: Record<string, unknown> | undefined,
  siteOrigin: string,
) {
  if (!properties) return;
  for (const key of URL_PROPERTIES) {
    const value = properties[key];
    if (typeof value === "string") properties[key] = scrubUrl(value);
  }
  for (const key of REFERRER_PROPERTIES) {
    const value = properties[key];
    if (typeof value === "string") {
      properties[key] = scrubReferrer(value, siteOrigin);
    }
  }
}

/**
 * PostHog `before_send` hook: scrub every URL on the event, including the
 * person-property copies in `$set` / `$set_once`, and tag the deploy
 * environment so staging traffic can be filtered out of reports.
 */
export function createBeforeSend(
  environment: string,
  siteOrigin: string,
): (event: CaptureResult | null) => CaptureResult | null {
  return (event) => {
    if (!event) return event;
    scrubProperties(event.properties, siteOrigin);
    scrubProperties(event.$set, siteOrigin);
    scrubProperties(event.$set_once, siteOrigin);
    event.properties.environment = environment;
    return event;
  };
}
