import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The tournament list moved from /tournaments to / (#615). The source has
      // no path params, so it matches only the exact path: /tournaments/[slug],
      // its register pages and /tournaments/archived are left alone. Next passes
      // the query string through, so filter links survive the redirect.
      {
        source: "/tournaments",
        destination: "/",
        permanent: true,
      },
    ];
  },
};

// withSentryConfig uploads source maps to Sentry at build time so stack traces
// show the original TypeScript. It reads SENTRY_ORG, SENTRY_PROJECT, and
// SENTRY_AUTH_TOKEN from the build environment (set in Netlify, never in the
// repo). Without a token there is nothing to upload to, so source maps are not
// generated at all; local and token-less builds behave exactly as before.
export default withSentryConfig(nextConfig, {
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  silent: !process.env.CI,
  telemetry: false,
});
