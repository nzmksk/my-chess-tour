import * as Sentry from "@sentry/nextjs";
import { sentryBaseOptions } from "@/services/sentry/options";

Sentry.init(sentryBaseOptions);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
