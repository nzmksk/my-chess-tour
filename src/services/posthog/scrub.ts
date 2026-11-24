import type { CaptureResult } from "posthog-js";

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

const SECRET_PATH_SEGMENTS: ReadonlyArray<[RegExp, string]> = [
  [/^\/invitations\/[^/]+/, "/invitations/:token"],
  [/^\/helper-invitations\/[^/]+/, "/helper-invitations/:token"],
  [/^\/claim\/[^/]+/, "/claim/:token"],
];

const URL_PROPERTIES = [
  "$current_url",
  "$initial_current_url",
  "$pathname",
  "$initial_pathname",
  "$prev_pageview_pathname",
  "$prev_pageview_url",
];

const REFERRER_PROPERTIES = ["$referrer", "$initial_referrer"];

const PARSE_BASE = "http://path.invalid";

function scrubPath(pathname: string): string {
  for (const [pattern, replacement] of SECRET_PATH_SEGMENTS) {
    if (pattern.test(pathname)) return pathname.replace(pattern, replacement);
  }
  return pathname;
}

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
