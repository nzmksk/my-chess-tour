/**
 * Settings shared by every `Sentry.init` call (browser, Node, edge).
 *
 * With no DSN the SDK stays disabled, so local development and the test suite
 * send nothing unless someone opts in by setting `NEXT_PUBLIC_SENTRY_DSN`.
 * Both values are `NEXT_PUBLIC_` because the browser SDK needs them; they are
 * inlined at build time, so each Netlify site (staging, production) bakes in
 * its own. A DSN is not a secret — it only allows sending events.
 *
 * Setup and the privacy reasoning: wiki/error-monitoring.md.
 */
export const sentryBaseOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  // Never attach IP addresses, cookies, or request bodies. Users are
  // identified to Sentry by nothing beyond what an error message contains.
  sendDefaultPii: false,
};
