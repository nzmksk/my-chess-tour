import { NextResponse, type NextRequest } from "next/server";
import { getClientIp } from "@/lib/http/request-ip";
import { isBrowserApiPath } from "@/lib/http/server-to-server";
import {
  internalErrorResponse,
  logInternalError,
} from "@/lib/http/internal-error";
import { hitWindow } from "./window";
import { RATE_LIMITS, type RateLimitName, type RateLimitRule } from "./limits";

const KEY_PREFIX = "ratelimit:";

export interface RateLimitSubject {
  ip: string | null;
  userId: string | null;
}

export class RateLimitUnavailableError extends Error {
  constructor(name: string, cause: unknown) {
    super(`Rate limit "${name}" could not be checked`, { cause });
    this.name = "RateLimitUnavailableError";
  }
}

export async function checkRateLimit(
  name: RateLimitName,
  { ip, userId }: RateLimitSubject,
): Promise<number> {
  const rule: RateLimitRule = RATE_LIMITS[name];
  const base = `${KEY_PREFIX}${name}:`;
  const hits: Promise<number>[] = [];

  if (rule.perUser && userId) {
    hits.push(
      hitWindow(`${base}user:${userId}`, rule.perUser, rule.windowSeconds),
    );
  }
  if (ip) {
    if (rule.perIp) {
      hits.push(hitWindow(`${base}ip:${ip}`, rule.perIp, rule.windowSeconds));
    }
    if (rule.perIpSignedOut && !userId) {
      hits.push(
        hitWindow(
          `${base}signed-out-ip:${ip}`,
          rule.perIpSignedOut,
          rule.windowSeconds,
        ),
      );
    }
  }
  if (hits.length === 0) return 0;

  try {
    return Math.max(...(await Promise.all(hits)));
  } catch (err) {
    if (rule.failClosed) throw new RateLimitUnavailableError(name, err);
    logInternalError(
      `Rate limit: "${name}" check failed, allowing the request`,
      err,
    );
    return 0;
  }
}

export function describeWait(seconds: number): string {
  if (seconds <= 60) return "a minute";
  if (seconds < 60 * 60) return `${Math.ceil(seconds / 60)} minutes`;
  const hours = Math.ceil(seconds / (60 * 60));
  return hours === 1 ? "an hour" : `${hours} hours`;
}

export function rateLimitedResponse(
  retryAfter: number,
  message: string,
): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfter));
  return NextResponse.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: `${message} Please try again in ${describeWait(seconds)}.`,
        retry_after: seconds,
      },
    },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}

export function isBaselineLimitedPath(pathname: string): boolean {
  return isBrowserApiPath(pathname);
}

export async function enforceApiBaseline(
  request: NextRequest,
  authUserId: string | null,
): Promise<NextResponse | null> {
  if (!authUserId || !isBaselineLimitedPath(request.nextUrl.pathname)) {
    return null;
  }
  return enforceRateLimit("api", request, authUserId);
}

export async function enforceRateLimit(
  name: RateLimitName,
  request: NextRequest,
  userId: string | null,
): Promise<NextResponse | null> {
  let retryAfter: number;
  try {
    retryAfter = await checkRateLimit(name, {
      ip: getClientIp(request),
      userId,
    });
  } catch (err) {
    return internalErrorResponse(`Rate limit: "${name}" check failed`, err);
  }
  return retryAfter > 0
    ? rateLimitedResponse(retryAfter, RATE_LIMITS[name].message)
    : null;
}
