import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {};

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
