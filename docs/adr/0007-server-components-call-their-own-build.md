# 0007. Server components call their own build's API

- Status: Accepted
- Date: 2026-11-21
- Issue: #675

## Context

Some server components fetch this app's own API routes. `NEXT_PUBLIC_SITE_URL`
is the canonical public URL ([site-url](../../wiki/site-url.md)); on a branch
deploy, a deploy preview or a dev server on another port it names a
_different_ build, whose routes may be older. That's how the organizer
dashboard once read a staging API without `bank_account` and told an org with
a pending account that it had none.

## Decision

`resolveRequestOrigin` (`src/lib/http/self-fetch.ts`) builds the origin of the
server handling the current request from `x-forwarded-host` (else `host`) and
`x-forwarded-proto` (else `http` for loopback hosts, `https` otherwise),
taking the first entry when a proxy has appended more. It falls back to
`NEXT_PUBLIC_SITE_URL` only when there's no host header.

`selfApiFetch` uses it to call a route on the same server, forwarding the
caller's cookies so the route sees the same session, and never caches.

## Consequences

- A preview always talks to its own API.
- The same origin is what [0005](0005-browser-api-origin-policy.md) compares
  against for same-origin checks.
