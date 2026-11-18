// API routes called by other servers, never by a browser, and authenticated on
// their own: CHIP calls the webhooks (RSA-signed) and the scheduler calls cron
// with CRON_SECRET. Browser-facing policies (the baseline rate limit, the
// origin check) skip them.
const SERVER_TO_SERVER_API_PREFIXES = ["/api/v1/webhooks/", "/api/v1/cron/"];

/** Whether this path is a server-to-server API route (webhooks, cron). */
export function isServerToServerPath(pathname: string): boolean {
  return SERVER_TO_SERVER_API_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}

/** Whether this path is an API route that browsers call. */
export function isBrowserApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/") && !isServerToServerPath(pathname);
}
