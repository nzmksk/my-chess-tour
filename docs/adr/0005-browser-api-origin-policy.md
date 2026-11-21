# 0005. Browser API origin policy

- Status: Accepted
- Date: 2026-11-21
- Issue: #614, #675

## Context

Every `/api` route authenticates with the Supabase session cookies, so a
browser attaches them to any request it sends, wherever the page that sent it
came from. Blocking a cross-site _read_ isn't enough: a cross-site "simple"
request (a form POST, a `text/plain` body) needs no preflight, so the browser
sends it, cookies included, and only hides the response.

## Decision

`src/lib/http/origin-policy.ts`, called from `src/proxy.ts`:

- **Reads.** Only allowed origins on another host get CORS headers
  (`applyCorsHeaders`): that exact origin, never `*`, with
  `Allow-Credentials`. Every API response varies by `Origin`, so a cache never
  hands one origin's answer to another. Same-origin requests need no CORS
  headers.
- **Writes.** A `POST`, `PUT`, `PATCH` or `DELETE` from an origin that isn't
  allowed gets a 403 before it reaches the route (`enforceApiOrigin`).
  Browsers send `Origin` on every cross-origin write (as `"null"` when it's
  hidden, which is refused). `Referer` is the fallback for older browsers that
  omit `Origin` on same-origin requests; an unparseable one counts as
  `"null"`. With neither header the caller isn't a browser, so there's no
  cookie-riding page to stop.
- **Allowed origins.** The request's own origin, plus `allowedOrigins()`:
  `NEXT_PUBLIC_SITE_URL` and its `admin.` subdomain. The request's own origin
  is what covers deploy previews, branch deploys and a dev server on any
  port. Previews are _not_ allowed to call another deployment: the repo is
  public, previews build pull-request code, and none of it should get
  credentialed access to staging or production.
- **Same origin means same scheme, host and port** (`isSameOrigin`), with the
  request's origin from `resolveRequestOrigin` ([0007](0007-server-components-call-their-own-build.md)).
  `http://our-host` isn't `https://our-host`: a network attacker serving plain
  HTTP on our hostname mustn't pass as same-origin, since browsers without
  schemeful SameSite would attach the cookies to its writes. A page on
  another site can't forge these headers: the browser writes `Host`, and a
  custom header needs a preflight that a disallowed origin fails.
- **Server-to-server routes are exempt.** `/api/v1/webhooks/` and
  `/api/v1/cron/` (`src/lib/http/server-to-server.ts`) are called by servers,
  carry no browser origin and authenticate on their own: CHIP signs with RSA,
  GitHub with HMAC, the scheduler sends `CRON_SECRET`. The origin check and
  the baseline rate limit skip them.
- Server actions get the same origin check from Next and aren't handled here.

## Consequences

- Any new browser-facing route is protected without doing anything.
- A new server-to-server route must live under one of the exempt prefixes and
  verify its caller itself.
