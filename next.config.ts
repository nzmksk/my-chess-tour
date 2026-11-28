import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import {
  resolveReleaseCommit,
  resolveReleaseVersion,
} from "./src/lib/release-version";

const nextConfig: NextConfig = {
  env: {
    APP_VERSION: resolveReleaseVersion(),
    APP_COMMIT: resolveReleaseCommit(),
  },
  turbopack: {
    rules: {
      "*.html": { condition: { query: "?raw" }, type: "text" },
    },
  },
  async redirects() {
    return [
      {
        source: "/tournaments",
        destination: "/",
        permanent: true,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  silent: !process.env.CI,
  telemetry: false,
});
