import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { sentryBaseOptions } from "@/services/sentry/options";

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (posthogToken && posthogHost) {
  posthog.init(posthogToken, {
    api_host: posthogHost,
    tracing_headers: [window.location.hostname],
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
    defaults: "2026-08-30",
  });
} else if (process.env.NODE_ENV === "development") {
  const missingVariable = posthogToken
    ? "NEXT_PUBLIC_POSTHOG_HOST"
    : "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN";

  console.error(
    `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
  );
}

Sentry.init(sentryBaseOptions);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
