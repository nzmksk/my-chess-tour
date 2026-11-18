import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockCreateServerClient, mockGetClaims } = vi.hoisted(() => ({
  mockCreateServerClient: vi.fn(),
  mockGetClaims: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mockCreateServerClient,
}));

import { proxy } from "../proxy";

const SITE = "https://staging.mychesstour.com";
const ADMIN = "https://admin.staging.mychesstour.com";
const EVIL = "https://evil.example";

function request(
  path: string,
  method: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`${SITE}${path}`, {
    method,
    headers: { host: "staging.mychesstour.com", ...headers },
  });
}

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  mockGetClaims.mockResolvedValue({ data: null });
  mockCreateServerClient.mockReturnValue({
    auth: { getClaims: mockGetClaims },
  });
});

afterEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

describe("proxy origin policy (#614)", () => {
  it("refuses a cross-site form POST to an API route before touching the session", async () => {
    const res = await proxy(
      request("/api/v1/tournaments/merdeka-open/checkout", "POST", {
        origin: EVIL,
        "content-type": "application/x-www-form-urlencoded",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });

  it("answers a preflight from an allowed origin without touching the session", async () => {
    const res = await proxy(
      request("/api/v1/profile", "OPTIONS", {
        origin: ADMIN,
        "access-control-request-method": "PATCH",
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ADMIN);
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });

  it("lets same-origin app traffic through", async () => {
    const res = await proxy(
      request("/api/v1/profile", "PATCH", { origin: SITE }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
    expect(mockGetClaims).toHaveBeenCalled();
  });

  it("adds CORS headers to an allowed cross-origin request", async () => {
    const res = await proxy(
      request("/api/v1/tournaments", "GET", { origin: ADMIN }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe(ADMIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it.each(["/api/v1/webhooks/chip", "/api/v1/cron/refunds"])(
    "leaves %s to its own caller verification",
    async (path) => {
      const res = await proxy(request(path, "POST"));
      expect(res.status).toBe(200);
      expect(res.headers.get("vary")).toBeNull();
    },
  );

  it("does not add CORS headers to pages", async () => {
    const res = await proxy(request("/", "GET", { origin: ADMIN }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
