import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRequestOrigin } from "../self-fetch";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const h = (init: Record<string, string>) => new Headers(init);

describe("resolveRequestOrigin", () => {
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  });

  it("uses the request host, not NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.mychesstour.com";
    expect(
      resolveRequestOrigin(
        h({ host: "deploy-preview-12--staging-mychesstour.netlify.app" }),
      ),
    ).toBe("https://deploy-preview-12--staging-mychesstour.netlify.app");
  });

  it("prefers forwarded host and proto", () => {
    expect(
      resolveRequestOrigin(
        h({
          host: "internal:8080",
          "x-forwarded-host": "www.mychesstour.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://www.mychesstour.com");
  });

  it("takes the first entry of a comma-separated forwarded header", () => {
    expect(
      resolveRequestOrigin(
        h({
          "x-forwarded-host": "a.example.com, b.example.com",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe("https://a.example.com");
  });

  it("defaults to http for loopback hosts on any port", () => {
    expect(resolveRequestOrigin(h({ host: "localhost:3001" }))).toBe(
      "http://localhost:3001",
    );
    expect(resolveRequestOrigin(h({ host: "127.0.0.1:3000" }))).toBe(
      "http://127.0.0.1:3000",
    );
  });

  it("falls back to NEXT_PUBLIC_SITE_URL without a host header", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.mychesstour.com";
    expect(resolveRequestOrigin(h({}))).toBe("https://www.mychesstour.com");
  });
});
