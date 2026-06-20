import type { NextRequest } from "next/server";

// Best-effort client IP for rate limiting. Cloudflare sets cf-connecting-ip;
// otherwise fall back to the standard proxy headers. Returns "unknown" when no
// header is present (e.g. local dev) — such requests then share one bucket.
export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
