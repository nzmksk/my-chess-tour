import type { NextRequest } from "next/server";

const PLATFORM_IP_HEADER = "x-nf-client-connection-ip";

let warnedMissing = false;

export function getClientIp(request: NextRequest): string | null {
  const ip = request.headers.get(PLATFORM_IP_HEADER)?.trim();
  if (ip) return ip;

  if (process.env.NODE_ENV !== "production") {
    return (
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
    );
  }

  if (!warnedMissing) {
    warnedMissing = true;
    console.error(
      `Rate limit: no ${PLATFORM_IP_HEADER} header on a request; per-IP limits are skipped`,
    );
  }
  return null;
}
