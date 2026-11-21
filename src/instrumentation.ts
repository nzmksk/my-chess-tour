import * as Sentry from "@sentry/nextjs";
import { createOnRequestError } from "@posthog/next";

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const posthogOnRequestError =
  posthogToken && posthogHost
    ? createOnRequestError({ apiKey: posthogToken, host: posthogHost })
    : null;

export async function register() {
  const { initServerSentry } = await import("@/services/sentry/server");
  initServerSentry();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerPostHogLogs } = await import("@/services/posthog/logs");
    registerPostHogLogs();
  }
}

export const onRequestError = async (
  ...args: Parameters<typeof Sentry.captureRequestError>
) => {
  Sentry.captureRequestError(...args);
  try {
    await posthogOnRequestError?.(...args);
  } catch {}
};
