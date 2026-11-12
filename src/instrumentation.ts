import * as Sentry from "@sentry/nextjs";

export async function register() {
  const { initServerSentry } = await import("@/services/sentry/server");
  initServerSentry();
}

// Errors thrown from Server Components, Route Handlers, Server Actions, and the
// proxy. Handled-and-logged failures are covered separately (see server.ts).
export const onRequestError = Sentry.captureRequestError;
