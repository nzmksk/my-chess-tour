import * as Sentry from "@sentry/nextjs";
import { sentryBaseOptions } from "@/lib/sentry/options";

// Uncaught errors and unhandled rejections in the browser. Session Replay and
// tracing are deliberately left off: Replay records what users see and type
// (PII), and both eat the free-tier quota. See wiki/error-monitoring.md.
Sentry.init(sentryBaseOptions);

// Navigation breadcrumbs; also what tracing would hook into if it is enabled.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
