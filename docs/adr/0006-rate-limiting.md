# 0006. Rate limiting

- Status: Accepted
- Date: 2026-11-21
- Issue: #675

## Context

Rate limits protect the routes that send mail, create CHIP purchases or call
third parties. Per-IP limits are only as good as the IP. We deploy on Netlify, not
behind Cloudflare, so `cf-connecting-ip` is whatever the client chose to send,
and the left-most `x-forwarded-for` entry is client-supplied too. Trusting
either lets an attacker rotate the header for a fresh bucket on every request.

## Decision

`getClientIp` (`src/lib/http/request-ip.ts`) reads only
`x-nf-client-connection-ip`, Netlify's own record of the client address. When
it's missing in production it returns `null`, and callers skip per-IP limits
rather than lump every visitor into one bucket. It warns once per instance,
so the gap is noticed without logging on every request.

Outside production, where `next dev` has no Netlify edge in front of it, it
falls back to `x-forwarded-for`, then `"local"`, so per-IP limits can still be
exercised locally.

## How limits count

The rules and their numbers are in [api-design](../../wiki/api-design.md#5-rate-limiting)
and `src/services/rate-limit/limits.ts`. Underneath them:

- **One primitive.** `hitWindow` (`src/services/rate-limit/window.ts`) runs
  `INCR`, `EXPIRE NX` and `TTL` in one `MULTI`/`EXEC`. A counter can never be
  left without an expiry, which the old incr-then-expire pairs allowed when the
  second call failed, locking a key out for good. `EXPIRE NX` starts the clock
  on the first hit only, so the window ends a fixed time after the first
  attempt however many follow.
- **Every bucket counts.** A rule can key on the user, the IP, or the IP only
  when signed out (a signed-out caller can't be told from the next one).
  Sensitive routes set both a user and an IP budget, so neither a fresh account
  nor a fresh IP buys a fresh allowance on its own. With no trustworthy IP
  there's no IP bucket, never a shared "unknown" one.
- **The baseline lives in the proxy** (`enforceApiBaseline`), so a new route is
  covered without opting in. It's keyed by the session's auth id, because the
  proxy has no `users.id`, and has no IP bucket: server components fetch the
  app's own API without the visitor's IP (ADR 0007), so an IP limit there
  would throttle every visitor together.
- **Fail-closed only where an unlimited endpoint is the bigger risk**: signup,
  and bug reports, which become public GitHub issues.
- **Login and verification counters are separate**
  (`src/services/rate-limit/auth.ts`) because each drives its own UX
  (attempts left, a lockout timer, a silent resend cooldown) rather than a
  plain 429, but they count with the same primitive. A resend that fails
  before the email goes out releases its cooldown, and a lock with no expiry
  counts as a full lockout rather than none.

## Consequences

- Moving off Netlify, or putting a CDN in front of it, means changing
  `PLATFORM_IP_HEADER` to that platform's trusted header.
- A missing header disables per-IP limits rather than breaking requests.
