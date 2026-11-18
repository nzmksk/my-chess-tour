import { describe, expect, it, vi } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";

// withSentryConfig only adds build-time source-map upload; pass the config through.
vi.mock("@sentry/nextjs/config", () => ({
  withSentryConfig: (config: unknown) => config,
}));

import nextConfig from "../../../next.config";

async function findRedirect(source: string) {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  return redirects.find((r) => r.source === source);
}

describe("next.config redirects", () => {
  it("permanently redirects the old /tournaments list to /", async () => {
    const redirect = await findRedirect("/tournaments");
    expect(redirect).toMatchObject({ destination: "/", permanent: true });
  });

  // Same matcher Next uses for custom routes, so this checks real matching
  // rather than the literal source string.
  const matches = getPathMatch("/tournaments", { strict: true });

  it("matches the exact /tournaments path", () => {
    expect(matches("/tournaments")).not.toBe(false);
  });

  it.each([
    "/tournaments/archived",
    "/tournaments/kl-open-2026",
    "/tournaments/kl-open-2026/register",
    "/tournaments/kl-open-2026/register/success",
    "/tournaments/kl-open-2026/register/failure",
  ])("does not redirect %s", (path) => {
    expect(matches(path)).toBe(false);
  });
});
