# 0006. Rate limits key on the platform's client IP

- Status: Accepted
- Date: 2026-11-21
- Issue: #675

## Context

Per-IP rate limits are only as good as the IP. We deploy on Netlify, not
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

## Consequences

- Moving off Netlify, or putting a CDN in front of it, means changing
  `PLATFORM_IP_HEADER` to that platform's trusted header.
- A missing header disables per-IP limits rather than breaking requests.
