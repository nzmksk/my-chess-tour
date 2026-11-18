import type { NextRequest } from "next/server";

// Netlify's own record of the client's address. We deploy on Netlify, not
// behind Cloudflare, so cf-connecting-ip is whatever the client chose to send,
// and the left-most x-forwarded-for entry is client-supplied too. Trusting
// either let an attacker rotate the header for a fresh rate-limit bucket on
// every request.
const PLATFORM_IP_HEADER = "x-nf-client-connection-ip";

let warnedMissing = false;

/**
 * The client IP for rate limiting, read only from the header the platform
 * sets. Returns null when there is none to trust, and callers then skip
 * per-IP limits rather than lump every visitor into one bucket.
 *
 * Outside production (next dev has no Netlify edge in front of it) the
 * standard proxy headers are used, so per-IP limits can still be exercised
 * locally.
 */
export function getClientIp(request: NextRequest): string | null {
  const ip = request.headers.get(PLATFORM_IP_HEADER)?.trim();
  if (ip) return ip;

  if (process.env.NODE_ENV !== "production") {
    return (
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
    );
  }

  // Once per instance: on Netlify this means per-IP limits are off, which
  // should be noticed, not logged on every request.
  if (!warnedMissing) {
    warnedMissing = true;
    console.error(
      `Rate limit: no ${PLATFORM_IP_HEADER} header on a request; per-IP limits are skipped`,
    );
  }
  return null;
}
