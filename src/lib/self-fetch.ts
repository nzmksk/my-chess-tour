import { headers } from "next/headers";

/**
 * Origin of the server handling the current request.
 *
 * Server components that call this app's own API must target the build that
 * is rendering them, not NEXT_PUBLIC_SITE_URL. That env var is the canonical
 * public URL; on a branch deploy, a deploy preview or a dev server on another
 * port it names a different build, whose routes may be older. That is how the
 * organizer dashboard once read a staging API without `bank_account` and told
 * an org with a pending account that it had none.
 *
 * Falls back to NEXT_PUBLIC_SITE_URL only when there is no host header.
 */
export function resolveRequestOrigin(h: Pick<Headers, "get">): string {
  const host =
    firstValue(h.get("x-forwarded-host")) ?? firstValue(h.get("host"));
  if (!host) {
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  }

  const proto =
    firstValue(h.get("x-forwarded-proto")) ??
    (isLoopback(host) ? "http" : "https");

  return `${proto}://${host}`;
}

/**
 * GET (by default) one of this app's own API routes from a server component,
 * on the same server, forwarding the caller's cookies so the route sees the
 * same session. Never cached.
 */
export async function selfApiFetch(
  path: string,
  init: Omit<RequestInit, "cache"> = {},
): Promise<Response> {
  const h = await headers();
  const forwarded = new Headers(init.headers);
  const cookie = h.get("cookie");
  if (cookie) forwarded.set("cookie", cookie);

  return fetch(`${resolveRequestOrigin(h)}${path}`, {
    ...init,
    cache: "no-store",
    headers: forwarded,
  });
}

// Proxies may append to these headers ("a, b"); the first entry is the client-facing one.
function firstValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

function isLoopback(host: string): boolean {
  const hostname = host.replace(/:\d+$/, "");
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}
