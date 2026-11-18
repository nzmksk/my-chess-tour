import { NextResponse, type NextRequest } from "next/server";
import { getClientIp } from "@/lib/http/request-ip";
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

/** Thrown for a fail-closed rule when the limit couldn't be checked. */
export class RateLimitUnavailableError extends Error {
  constructor(name: string, cause: unknown) {
    super(`Rate limit "${name}" could not be checked`, { cause });
    this.name = "RateLimitUnavailableError";
  }
}

/**
 * Count one request against every bucket of the named rule. Returns the
 * seconds to wait (for Retry-After) when any bucket is over its limit, or 0
 * when the request may go ahead.
 *
 * If Redis can't be reached the request is allowed and the failure logged,
 * unless the rule is fail-closed, in which case RateLimitUnavailableError is
 * thrown.
 */
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
  // No trustworthy IP (see getClientIp) means no IP bucket: one shared
  // "unknown" bucket would rate limit every visitor together.
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

/** "a minute", "12 minutes", "an hour", "3 hours". */
export function describeWait(seconds: number): string {
  if (seconds <= 60) return "a minute";
  if (seconds < 60 * 60) return `${Math.ceil(seconds / 60)} minutes`;
  const hours = Math.ceil(seconds / (60 * 60));
  return hours === 1 ? "an hour" : `${hours} hours`;
}

/**
 * The one 429 shape every limited route returns: the usual error envelope,
 * whose message the UI shows as is, plus Retry-After.
 */
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

/**
 * Apply the named rule to a route request. Returns the response to send when
 * the request is refused (429, or 500 when a fail-closed rule can't be
 * checked), or null when it may go ahead.
 *
 *   const limited = await enforceRateLimit("checkout", request, userId);
 *   if (limited) return limited;
 */
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
