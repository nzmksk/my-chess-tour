import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockHitWindow, mockGetClientIp, mockConsoleError } = vi.hoisted(() => ({
  mockHitWindow: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockConsoleError: vi.fn(),
}));

vi.mock("../window", () => ({ hitWindow: mockHitWindow }));
vi.mock("@/lib/http/request-ip", () => ({ getClientIp: mockGetClientIp }));

import {
  checkRateLimit,
  describeWait,
  enforceApiBaseline,
  enforceRateLimit,
  isBaselineLimitedPath,
  rateLimitedResponse,
  RateLimitUnavailableError,
} from "../limiter";
import { RATE_LIMITS } from "../limits";

// Seconds to wait per key; anything not listed is within its limit.
function waitsByKey(waits: Record<string, number>) {
  mockHitWindow.mockImplementation(async (key: string) => waits[key] ?? 0);
}

function keysHit(): string[] {
  return mockHitWindow.mock.calls.map(([key]) => key as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(mockConsoleError);
  waitsByKey({});
});

describe("checkRateLimit", () => {
  it("counts a signed-in request against the user and IP buckets", async () => {
    expect(
      await checkRateLimit("checkout", { ip: "1.2.3.4", userId: "u1" }),
    ).toBe(0);
    expect(keysHit()).toEqual([
      "ratelimit:checkout:user:u1",
      "ratelimit:checkout:ip:1.2.3.4",
    ]);
    expect(mockHitWindow).toHaveBeenCalledWith(
      "ratelimit:checkout:user:u1",
      RATE_LIMITS.checkout.perUser,
      RATE_LIMITS.checkout.windowSeconds,
    );
  });

  it("adds the signed-out IP bucket only when nobody is signed in", async () => {
    await checkRateLimit("feedback", { ip: "1.2.3.4", userId: null });
    expect(keysHit()).toEqual([
      "ratelimit:feedback:ip:1.2.3.4",
      "ratelimit:feedback:signed-out-ip:1.2.3.4",
    ]);

    mockHitWindow.mockClear();
    await checkRateLimit("feedback", { ip: "1.2.3.4", userId: "u1" });
    expect(keysHit()).toEqual([
      "ratelimit:feedback:user:u1",
      "ratelimit:feedback:ip:1.2.3.4",
    ]);
  });

  it("skips IP buckets when there is no trustworthy client IP", async () => {
    await checkRateLimit("checkout", { ip: null, userId: "u1" });
    expect(keysHit()).toEqual(["ratelimit:checkout:user:u1"]);
  });

  it("does nothing when no bucket applies", async () => {
    expect(await checkRateLimit("signup", { ip: null, userId: null })).toBe(0);
    expect(mockHitWindow).not.toHaveBeenCalled();
  });

  it("returns the longest wait across the buckets that are over", async () => {
    waitsByKey({
      "ratelimit:checkout:user:u1": 120,
      "ratelimit:checkout:ip:1.2.3.4": 400,
    });
    expect(
      await checkRateLimit("checkout", { ip: "1.2.3.4", userId: "u1" }),
    ).toBe(400);
  });

  it("fails open and logs when Redis is unreachable", async () => {
    mockHitWindow.mockRejectedValue(new Error("redis down"));
    expect(
      await checkRateLimit("checkout", { ip: "1.2.3.4", userId: "u1" }),
    ).toBe(0);
    expect(mockConsoleError).toHaveBeenCalled();
  });

  it("fails closed for rules that say so", async () => {
    mockHitWindow.mockRejectedValue(new Error("redis down"));
    await expect(
      checkRateLimit("signup", { ip: "1.2.3.4", userId: null }),
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });
});

describe("describeWait", () => {
  it.each([
    [1, "a minute"],
    [60, "a minute"],
    [61, "2 minutes"],
    [599, "10 minutes"],
    [3600, "an hour"],
    [3601, "2 hours"],
  ])("%i seconds reads as %s", (seconds, text) => {
    expect(describeWait(seconds)).toBe(text);
  });
});

describe("rateLimitedResponse", () => {
  it("returns 429 with Retry-After and the shared error shape", async () => {
    const res = rateLimitedResponse(600, "Too many attempts.");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(await res.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many attempts. Please try again in 10 minutes.",
        retry_after: 600,
      },
    });
  });

  it("never sends a Retry-After below one second", () => {
    expect(rateLimitedResponse(0.2, "x").headers.get("Retry-After")).toBe("1");
  });
});

describe("enforceRateLimit", () => {
  const request = new NextRequest("http://localhost/api/v1/x", {
    method: "POST",
  });

  beforeEach(() => {
    mockGetClientIp.mockReturnValue("1.2.3.4");
  });

  it("returns null when the request is within its limits", async () => {
    expect(await enforceRateLimit("checkout", request, "u1")).toBeNull();
    expect(mockGetClientIp).toHaveBeenCalledWith(request);
  });

  it("returns a 429 with the rule's message when over", async () => {
    waitsByKey({ "ratelimit:checkout:user:u1": 90 });
    const res = await enforceRateLimit("checkout", request, "u1");
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("90");
    expect((await res?.json()).error.message).toBe(
      `${RATE_LIMITS.checkout.message} Please try again in 2 minutes.`,
    );
  });

  it("returns a generic 500 when a fail-closed rule can't be checked", async () => {
    mockHitWindow.mockRejectedValue(new Error("redis down"));
    const res = await enforceRateLimit("signup", request, null);
    expect(res?.status).toBe(500);
    expect((await res?.json()).error.code).toBe("INTERNAL_ERROR");
  });
});

describe("isBaselineLimitedPath", () => {
  it.each([
    ["/api/v1/tournaments", true],
    ["/api/v1/organizations/x/members/invite", true],
    ["/api/v1/webhooks/chip", false],
    ["/api/v1/webhooks/chip/send", false],
    ["/api/v1/cron/refunds", false],
    ["/tournaments/merdeka-open", false],
  ])("%s → %s", (pathname, limited) => {
    expect(isBaselineLimitedPath(pathname)).toBe(limited);
  });
});

describe("enforceApiBaseline", () => {
  const apiRequest = (path: string) =>
    new NextRequest(`http://localhost${path}`, { method: "POST" });

  beforeEach(() => {
    mockGetClientIp.mockReturnValue("1.2.3.4");
  });

  it("counts a signed-in API request against the user's baseline only", async () => {
    expect(
      await enforceApiBaseline(apiRequest("/api/v1/profile"), "auth-1"),
    ).toBeNull();
    expect(keysHit()).toEqual(["ratelimit:api:user:auth-1"]);
    expect(mockHitWindow).toHaveBeenCalledWith(
      "ratelimit:api:user:auth-1",
      RATE_LIMITS.api.perUser,
      RATE_LIMITS.api.windowSeconds,
    );
  });

  it("429s once the user is over the baseline", async () => {
    waitsByKey({ "ratelimit:api:user:auth-1": 30 });
    const res = await enforceApiBaseline(
      apiRequest("/api/v1/profile"),
      "auth-1",
    );
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("30");
  });

  it("counts nothing for signed-out requests, webhooks, cron or pages", async () => {
    expect(
      await enforceApiBaseline(apiRequest("/api/v1/tournaments"), null),
    ).toBeNull();
    expect(
      await enforceApiBaseline(apiRequest("/api/v1/webhooks/chip"), "auth-1"),
    ).toBeNull();
    expect(
      await enforceApiBaseline(apiRequest("/api/v1/cron/payouts"), "auth-1"),
    ).toBeNull();
    expect(await enforceApiBaseline(apiRequest("/my"), "auth-1")).toBeNull();
    expect(mockHitWindow).not.toHaveBeenCalled();
  });
});
