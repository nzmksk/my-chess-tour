import { NextResponse, type NextRequest } from "next/server";
import { resolveRequestOrigin } from "./self-fetch";
import { isBrowserApiPath } from "./server-to-server";

/**
 * CORS and origin policy for the browser-facing API (#614).
 *
 * Every /api route authenticates with the Supabase session cookies, so a
 * browser attaches them to any request it sends, wherever the page that sent
 * it came from. Two rules follow:
 *
 * - Reads: only our own origins get CORS headers, so a page elsewhere can't
 *   read a response. Same-origin requests need no CORS headers at all.
 * - Writes: a cross-site "simple" request (a form POST, or a text/plain body)
 *   needs no preflight, so the browser sends it, cookies included, and only
 *   hides the response. Blocking the read is not enough; a state-changing
 *   request from an origin we don't allow is refused with a 403 before it
 *   reaches the route.
 *
 * Server actions already get the same origin check from Next. Webhooks and
 * cron are called by servers, carry no browser origin and verify their callers
 * themselves, so they are skipped.
 */

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
};

/**
 * Origins on other hosts that may call the API with credentials, derived from
 * NEXT_PUBLIC_SITE_URL: the site itself and its admin subdomain
 * (www.mychesstour.com → admin.mychesstour.com, staging.mychesstour.com →
 * admin.staging.mychesstour.com).
 *
 * The origin serving the request is always allowed on top of these (see
 * isAllowedOrigin), which is what covers deploy previews, branch deploys and a
 * dev server on any port. Deploy previews are not on this list on purpose:
 * the repo is public, previews build pull-request code, and none of it should
 * get credentialed access to another deployment's API.
 */
export function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const site = parseOrigin(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  );
  if (!site) return origins;

  origins.add(site.origin);
  const admin = new URL(site.origin);
  admin.hostname = `admin.${site.hostname.replace(/^www\./, "")}`;
  origins.add(admin.origin);
  return origins;
}

/**
 * Whether a request from `origin` may use the API: either the request's own
 * origin or one of allowedOrigins(). "null" and anything that
 * isn't an http(s) origin are never allowed.
 */
export function isAllowedOrigin(origin: string, request: NextRequest): boolean {
  const parsed = parseOrigin(origin);
  if (!parsed) return false;
  return isSameOrigin(parsed, request) || allowedOrigins().has(parsed.origin);
}

/**
 * Refuse API requests from origins we don't allow. Returns the response to
 * send (a preflight answer or a 403), or null when the request may go on to
 * the route.
 */
export function enforceApiOrigin(request: NextRequest): NextResponse | null {
  if (!isBrowserApiPath(request.nextUrl.pathname)) return null;

  const method = request.method.toUpperCase();
  const origin = request.headers.get("origin");

  if (method === "OPTIONS") {
    // No Origin means this isn't a CORS preflight; let Next answer it.
    if (origin === null) return null;
    if (!isAllowedOrigin(origin, request)) return forbiddenOrigin();
    return new NextResponse(null, {
      status: 204,
      headers: {
        ...PREFLIGHT_HEADERS,
        ...credentialedCorsHeaders(origin),
        Vary: "Origin",
      },
    });
  }

  if (!STATE_CHANGING_METHODS.has(method)) return null;

  // Browsers send Origin on every cross-origin POST/PUT/PATCH/DELETE (as
  // "null" when it is hidden, which is refused). Referer is the fallback for
  // older browsers that omit Origin on same-origin requests. With neither,
  // the caller isn't a browser, so there is no cookie-riding page to stop.
  const source = origin ?? refererOrigin(request);
  if (source === null) return null;
  return isAllowedOrigin(source, request) ? null : forbiddenOrigin();
}

/**
 * Add CORS headers to an API response. A request from an allowed origin on
 * another host gets Access-Control-Allow-Origin (that exact origin, never *)
 * and Allow-Credentials. Every API response varies by Origin, so caches don't
 * hand one origin's answer to another.
 */
export function applyCorsHeaders(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  if (!isBrowserApiPath(request.nextUrl.pathname)) return response;

  response.headers.append("Vary", "Origin");

  const origin = request.headers.get("origin");
  const parsed = origin ? parseOrigin(origin) : null;
  if (
    origin &&
    parsed &&
    !isSameOrigin(parsed, request) &&
    allowedOrigins().has(parsed.origin)
  ) {
    for (const [name, value] of Object.entries(
      credentialedCorsHeaders(origin),
    )) {
      response.headers.set(name, value);
    }
  }
  return response;
}

function credentialedCorsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
  };
}

function forbiddenOrigin(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "FORBIDDEN_ORIGIN",
        message: "Requests from this origin are not allowed.",
      },
    },
    { status: 403, headers: { Vary: "Origin" } },
  );
}

function refererOrigin(request: NextRequest): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  // An unparseable Referer is still a browser saying where it came from, and
  // "null" fails the check below.
  return parseOrigin(referer)?.origin ?? "null";
}

function parseOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Whether the origin is the one this request was sent to: same scheme, host
 * and port. The request's origin comes from resolveRequestOrigin, which reads
 * x-forwarded-host (else host) and x-forwarded-proto (else http only for
 * loopback hosts, https otherwise).
 *
 * The scheme matters: http://our-host is a different origin from
 * https://our-host. A network attacker who can serve a page over plain HTTP on
 * our hostname must not pass as same-origin, since browsers without
 * schemeful SameSite would attach the auth cookies to its writes.
 *
 * A page on another site can't set any of these headers on a victim's
 * request: the browser writes Host, and a custom header would need a
 * preflight, which a disallowed origin fails.
 */
function isSameOrigin(origin: URL, request: NextRequest): boolean {
  return origin.origin === resolveRequestOrigin(request.headers).toLowerCase();
}
