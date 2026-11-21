import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { sentryBaseOptions } from "@/services/sentry/options";
import { posthogKey, posthogOptions } from "@/services/posthog/options";

Sentry.init(sentryBaseOptions);

if (posthogKey) {
  posthog.init(posthogKey, posthogOptions(window.location.origin));
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
