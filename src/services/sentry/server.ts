import * as Sentry from "@sentry/nextjs";
import { flushAfterResponseIntegration } from "./flush-after-response";
import { sentryBaseOptions } from "./options";

/**
 * Server-side (Node and edge) Sentry setup, called from `register()` in
 * src/instrumentation.ts.
 *
 * Thrown errors reach Sentry through `onRequestError`. Most failures in this
 * app are not thrown, though: route handlers catch them, `console.error` the
 * details for manual ops, and return a 4xx/5xx (CHIP calls, refund settlement,
 * payouts, webhook reconciliation). `captureConsoleIntegration` turns each of
 * those `console.error` calls into a Sentry event, so the existing logging
 * becomes the alerting with no per-call-site changes.
 */
export function initServerSentry() {
  Sentry.init({
    ...sentryBaseOptions,
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ["error"] }),
      flushAfterResponseIntegration(),
    ],
  });
}
