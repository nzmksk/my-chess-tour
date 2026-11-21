import * as Sentry from "@sentry/nextjs";

export async function register() {
  const { initServerSentry } = await import("@/services/sentry/server");
  initServerSentry();
}

export const onRequestError = Sentry.captureRequestError;
