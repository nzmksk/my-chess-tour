import * as Sentry from "@sentry/nextjs";
import { flushAfterResponseIntegration } from "./flush-after-response";
import { sentryBaseOptions } from "./options";

export function initServerSentry() {
  Sentry.init({
    ...sentryBaseOptions,
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ["error"] }),
      flushAfterResponseIntegration(),
    ],
  });
}
