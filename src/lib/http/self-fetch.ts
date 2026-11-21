import { headers } from "next/headers";

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
