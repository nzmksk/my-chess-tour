import { NextResponse, type NextRequest } from "next/server";
import { resolveRequestOrigin } from "./self-fetch";
import { isBrowserApiPath } from "./server-to-server";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
};

export function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const site = parseOrigin(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  );
  if (!site) return origins;

  origins.add(site.origin);
  const admin = new URL(site.origin);
  admin.hostname = `admin.${site.hostname.replace(/^www\./, "")}`;
  origins.add(admin.origin);
  return origins;
}

export function isAllowedOrigin(origin: string, request: NextRequest): boolean {
  const parsed = parseOrigin(origin);
  if (!parsed) return false;
  return isSameOrigin(parsed, request) || allowedOrigins().has(parsed.origin);
}

export function enforceApiOrigin(request: NextRequest): NextResponse | null {
  if (!isBrowserApiPath(request.nextUrl.pathname)) return null;

  const method = request.method.toUpperCase();
  const origin = request.headers.get("origin");

  if (method === "OPTIONS") {
    if (origin === null) return null;
    if (!isAllowedOrigin(origin, request)) return forbiddenOrigin();
    return new NextResponse(null, {
      status: 204,
      headers: {
        ...PREFLIGHT_HEADERS,
        ...credentialedCorsHeaders(origin),
        Vary: "Origin",
      },
    });
  }

  if (!STATE_CHANGING_METHODS.has(method)) return null;

  const source = origin ?? refererOrigin(request);
  if (source === null) return null;
  return isAllowedOrigin(source, request) ? null : forbiddenOrigin();
}

export function applyCorsHeaders(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  if (!isBrowserApiPath(request.nextUrl.pathname)) return response;

  response.headers.append("Vary", "Origin");

  const origin = request.headers.get("origin");
  const parsed = origin ? parseOrigin(origin) : null;
  if (
    origin &&
    parsed &&
    !isSameOrigin(parsed, request) &&
    allowedOrigins().has(parsed.origin)
  ) {
    for (const [name, value] of Object.entries(
      credentialedCorsHeaders(origin),
    )) {
      response.headers.set(name, value);
    }
  }
  return response;
}

function credentialedCorsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
  };
}

function forbiddenOrigin(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "FORBIDDEN_ORIGIN",
        message: "Requests from this origin are not allowed.",
      },
    },
    { status: 403, headers: { Vary: "Origin" } },
  );
}

function refererOrigin(request: NextRequest): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  return parseOrigin(referer)?.origin ?? "null";
}

function parseOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function isSameOrigin(origin: URL, request: NextRequest): boolean {
  return origin.origin === resolveRequestOrigin(request.headers).toLowerCase();
}
