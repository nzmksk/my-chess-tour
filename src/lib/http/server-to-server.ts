const SERVER_TO_SERVER_API_PREFIXES = ["/api/v1/webhooks/", "/api/v1/cron/"];

export function isServerToServerPath(pathname: string): boolean {
  return SERVER_TO_SERVER_API_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}

export function isBrowserApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/") && !isServerToServerPath(pathname);
}
