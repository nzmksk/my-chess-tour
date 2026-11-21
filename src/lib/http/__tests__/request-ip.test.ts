import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function requestWith(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/v1/x", { headers });
}

async function loadGetClientIp() {
  vi.resetModules();
  return (await import("../request-ip")).getClientIp;
}

const consoleError = vi.fn();

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(consoleError);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("getClientIp in production", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  it("reads the IP Netlify records for the connection", async () => {
    const getClientIp = await loadGetClientIp();
    expect(
      getClientIp(requestWith({ "x-nf-client-connection-ip": "203.0.113.7" })),
    ).toBe("203.0.113.7");
  });

  it("ignores client-supplied cf-connecting-ip and x-forwarded-for", async () => {
    const getClientIp = await loadGetClientIp();
    const real = { "x-nf-client-connection-ip": "203.0.113.7" };

    for (const spoofed of ["198.51.100.1", "198.51.100.2"]) {
      expect(
        getClientIp(
          requestWith({
            ...real,
            "cf-connecting-ip": spoofed,
            "x-forwarded-for": `${spoofed}, 203.0.113.7`,
            "x-real-ip": spoofed,
          }),
        ),
      ).toBe("203.0.113.7");
    }
  });

  it("returns null without the platform header, never a spoofable one", async () => {
    const getClientIp = await loadGetClientIp();
    expect(
      getClientIp(
        requestWith({
          "cf-connecting-ip": "198.51.100.1",
          "x-forwarded-for": "198.51.100.1",
        }),
      ),
    ).toBeNull();
  });

  it("logs the missing header once, not on every request", async () => {
    const getClientIp = await loadGetClientIp();
    getClientIp(requestWith({}));
    getClientIp(requestWith({}));
    expect(consoleError).toHaveBeenCalledOnce();
  });
});

describe("getClientIp in development", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  it("still prefers the platform header", async () => {
    const getClientIp = await loadGetClientIp();
    expect(
      getClientIp(
        requestWith({
          "x-nf-client-connection-ip": "203.0.113.7",
          "x-forwarded-for": "198.51.100.1",
        }),
      ),
    ).toBe("203.0.113.7");
  });

  it("falls back to x-forwarded-for, then a shared local bucket", async () => {
    const getClientIp = await loadGetClientIp();
    expect(
      getClientIp(requestWith({ "x-forwarded-for": "::1, 10.0.0.1" })),
    ).toBe("::1");
    expect(getClientIp(requestWith({}))).toBe("local");
    expect(consoleError).not.toHaveBeenCalled();
  });
});
