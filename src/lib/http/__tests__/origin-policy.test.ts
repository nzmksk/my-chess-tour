import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  allowedOrigins,
  applyCorsHeaders,
  enforceApiOrigin,
  isAllowedOrigin,
} from "../origin-policy";

const SITE = "https://staging.mychesstour.com";
const ADMIN = "https://admin.staging.mychesstour.com";
const EVIL = "https://evil.example";

function apiRequest(
  path: string,
  {
    method = "GET",
    host = "staging.mychesstour.com",
    headers = {},
  }: {
    method?: string;
    host?: string;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  return new NextRequest(`https://${host}${path}`, {
    method,
    headers: { host, ...headers },
  });
}

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
});

afterEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

describe("allowedOrigins", () => {
  it("allows the site and its admin subdomain", () => {
    expect([...allowedOrigins()]).toEqual([SITE, ADMIN]);
  });

  it("puts admin on the apex, not under www", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.mychesstour.com";
    expect([...allowedOrigins()]).toEqual([
      "https://www.mychesstour.com",
      "https://admin.mychesstour.com",
    ]);
  });

  it("keeps the port and drops any path", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000/";
    expect([...allowedOrigins()]).toEqual([
      "http://localhost:3000",
      "http://admin.localhost:3000",
    ]);
  });

  it("falls back to localhost when NEXT_PUBLIC_SITE_URL is unset", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(allowedOrigins().has("http://localhost:3000")).toBe(true);
  });

  it("is empty when NEXT_PUBLIC_SITE_URL is not a URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "not a url";
    expect(allowedOrigins().size).toBe(0);
  });
});

describe("isAllowedOrigin", () => {
  const request = apiRequest("/api/v1/profile");

  it.each([
    [SITE, true],
    [ADMIN, true],
    [EVIL, false],
    ["https://mychesstour.com", false],
    ["https://staging.mychesstour.com.evil.example", false],
    ["null", false],
    ["file://", false],
    ["", false],
  ])("%s → %s", (origin, expected) => {
    expect(isAllowedOrigin(origin, request)).toBe(expected);
  });

  it("allows the host serving the request, e.g. a deploy preview", () => {
    const preview = "deploy-preview-42--staging-mychesstour.netlify.app";
    expect(
      isAllowedOrigin(
        `https://${preview}`,
        apiRequest("/api/v1/profile", {
          host: preview,
        }),
      ),
    ).toBe(true);
  });

  it("does not allow a deploy preview to call another deployment", () => {
    expect(
      isAllowedOrigin(
        "https://deploy-preview-42--staging-mychesstour.netlify.app",
        request,
      ),
    ).toBe(false);
  });

  it("prefers x-forwarded-host over host", () => {
    const forwarded = apiRequest("/api/v1/profile", {
      host: "internal:8080",
      headers: { "x-forwarded-host": "preview.example, internal:8080" },
    });
    expect(isAllowedOrigin("https://preview.example", forwarded)).toBe(true);
    expect(isAllowedOrigin("https://internal:8080", forwarded)).toBe(false);
  });

  it("allows a dev server on another port as same origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    const dev = new NextRequest("http://localhost:3001/api/v1/profile", {
      headers: { host: "localhost:3001" },
    });
    expect(isAllowedOrigin("http://localhost:3001", dev)).toBe(true);
    expect(isAllowedOrigin("http://localhost:4000", dev)).toBe(false);
  });
});

describe("enforceApiOrigin", () => {
  describe("state-changing requests", () => {
    it.each(["POST", "PUT", "PATCH", "DELETE"])(
      "refuses %s from a disallowed origin with 403",
      async (method) => {
        const res = enforceApiOrigin(
          apiRequest("/api/v1/profile", { method, headers: { origin: EVIL } }),
        );
        expect(res?.status).toBe(403);
        expect(await res?.json()).toEqual({
          error: {
            code: "FORBIDDEN_ORIGIN",
            message: "Requests from this origin are not allowed.",
          },
        });
        expect(res?.headers.get("access-control-allow-origin")).toBeNull();
      },
    );

    it("refuses a cross-site form POST (Origin: null)", () => {
      const res = enforceApiOrigin(
        apiRequest("/api/v1/tournaments/x/checkout", {
          method: "POST",
          headers: {
            origin: "null",
            "content-type": "application/x-www-form-urlencoded",
          },
        }),
      );
      expect(res?.status).toBe(403);
    });

    it("lets a same-origin POST through", () => {
      expect(
        enforceApiOrigin(
          apiRequest("/api/v1/profile", {
            method: "PATCH",
            headers: { origin: SITE },
          }),
        ),
      ).toBeNull();
    });

    it("lets a POST from the admin subdomain through", () => {
      expect(
        enforceApiOrigin(
          apiRequest("/api/v1/admin/oku/1", {
            method: "POST",
            headers: { origin: ADMIN },
          }),
        ),
      ).toBeNull();
    });

    it("falls back to Referer when Origin is missing", () => {
      expect(
        enforceApiOrigin(
          apiRequest("/api/v1/profile", {
            method: "POST",
            headers: { referer: `${SITE}/settings` },
          }),
        ),
      ).toBeNull();
      expect(
        enforceApiOrigin(
          apiRequest("/api/v1/profile", {
            method: "POST",
            headers: { referer: `${EVIL}/page` },
          }),
        )?.status,
      ).toBe(403);
    });

    it("refuses an unparseable Referer", () => {
      expect(
        enforceApiOrigin(
          apiRequest("/api/v1/profile", {
            method: "POST",
            headers: { referer: "android-app://com.evil/" },
          }),
        )?.status,
      ).toBe(403);
    });

    it("prefers Origin over Referer", () => {
      expect(
        enforceApiOrigin(
          apiRequest("/api/v1/profile", {
            method: "POST",
            headers: { origin: EVIL, referer: `${SITE}/settings` },
          }),
        )?.status,
      ).toBe(403);
    });

    it("lets a request with neither Origin nor Referer through (not a browser)", () => {
      expect(
        enforceApiOrigin(apiRequest("/api/v1/profile", { method: "POST" })),
      ).toBeNull();
    });
  });

  describe("reads", () => {
    it("leaves a cross-origin GET to the browser's CORS check", () => {
      expect(
        enforceApiOrigin(
          apiRequest("/api/v1/tournaments", { headers: { origin: EVIL } }),
        ),
      ).toBeNull();
    });
  });

  describe("preflights", () => {
    const preflight = (origin: string | null) =>
      apiRequest("/api/v1/profile", {
        method: "OPTIONS",
        headers: {
          ...(origin === null ? {} : { origin }),
          "access-control-request-method": "PATCH",
          "access-control-request-headers": "content-type",
        },
      });

    it("answers an allowed origin with the exact origin and credentials", () => {
      const res = enforceApiOrigin(preflight(ADMIN));
      expect(res?.status).toBe(204);
      expect(res?.headers.get("access-control-allow-origin")).toBe(ADMIN);
      expect(res?.headers.get("access-control-allow-credentials")).toBe("true");
      expect(res?.headers.get("access-control-allow-methods")).toBe(
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      expect(res?.headers.get("access-control-allow-headers")).toBe(
        "Content-Type",
      );
      expect(res?.headers.get("vary")).toBe("Origin");
    });

    it("refuses a disallowed origin without CORS headers", () => {
      const res = enforceApiOrigin(preflight(EVIL));
      expect(res?.status).toBe(403);
      expect(res?.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("leaves an OPTIONS without Origin to Next", () => {
      expect(enforceApiOrigin(preflight(null))).toBeNull();
    });
  });

  describe("exclusions", () => {
    it.each(["/api/v1/webhooks/chip", "/api/v1/cron/refunds"])(
      "skips %s, which servers call",
      (path) => {
        expect(
          enforceApiOrigin(
            apiRequest(path, { method: "POST", headers: { origin: EVIL } }),
          ),
        ).toBeNull();
        expect(
          enforceApiOrigin(
            apiRequest(path, { method: "OPTIONS", headers: { origin: EVIL } }),
          ),
        ).toBeNull();
      },
    );

    it("skips pages, which server actions already guard", () => {
      expect(
        enforceApiOrigin(
          apiRequest("/settings", {
            method: "POST",
            headers: { origin: EVIL },
          }),
        ),
      ).toBeNull();
    });
  });
});

describe("applyCorsHeaders", () => {
  const respond = (req: NextRequest) =>
    applyCorsHeaders(req, NextResponse.next());

  it("adds the exact origin and credentials for an allowed origin on another host", () => {
    const res = respond(
      apiRequest("/api/v1/tournaments", { headers: { origin: ADMIN } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe(ADMIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("adds no CORS headers for a disallowed origin", () => {
    const res = respond(
      apiRequest("/api/v1/tournaments", { headers: { origin: EVIL } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("adds no CORS headers for a same-origin request", () => {
    const res = respond(
      apiRequest("/api/v1/tournaments", { headers: { origin: SITE } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("keeps an existing Vary value", () => {
    const res = NextResponse.next();
    res.headers.set("Vary", "Accept-Encoding");
    applyCorsHeaders(
      apiRequest("/api/v1/tournaments", { headers: { origin: ADMIN } }),
      res,
    );
    expect(res.headers.get("vary")).toBe("Accept-Encoding, Origin");
  });

  it.each(["/api/v1/webhooks/chip", "/settings"])("leaves %s alone", (path) => {
    const res = respond(apiRequest(path, { headers: { origin: ADMIN } }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBeNull();
  });
});
