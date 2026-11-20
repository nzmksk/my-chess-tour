import type { PostHogConfig } from "posthog-js";
import { createBeforeSend } from "./scrub";

/**
 * Product analytics (PostHog), browser only. Setup and the privacy reasoning:
 * wiki/analytics.md.
 *
 * With no project key the SDK is never initialised, so local development and
 * the test suite send nothing unless someone opts in by setting
 * `NEXT_PUBLIC_POSTHOG_KEY`. The values are `NEXT_PUBLIC_` and inlined at build
 * time, so each Netlify site bakes in its own. A project key is not a secret:
 * it only allows sending events.
 */
export const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

// PostHog Cloud US. Set NEXT_PUBLIC_POSTHOG_HOST for the EU region, or to point
// at a reverse proxy if ad-blockers turn out to drop too many events.
const DEFAULT_API_HOST = "https://us.i.posthog.com";

export function posthogOptions(siteOrigin: string): Partial<PostHogConfig> {
  return {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_API_HOST,
    // Pinned so an SDK upgrade can't change behaviour silently. Among other
    // things this captures a $pageview on every client-side navigation.
    defaults: "2026-08-30",

    // No cookies, localStorage, or sessionStorage. PostHog counts unique
    // visitors with a daily-rotating hash computed on its servers, which keeps
    // the privacy policy's "no tracking cookies" true and needs no consent
    // banner. Requires cookieless mode to be enabled in the project settings,
    // or every event is dropped (wiki/analytics.md, step 3).
    cookieless_mode: "always",
    // Visitors are never identified (no posthog.identify), so events can't be
    // tied back to an account.
    person_profiles: "identified_only",
    respect_dnt: true,

    // Autocapture records clicks, but not the text on the page: names, emails
    // and ratings render as text throughout the app.
    mask_all_text: true,
    before_send: createBeforeSend(
      process.env.NEXT_PUBLIC_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
      siteOrigin,
    ),

    // Off whatever the project settings say. Replay records what people see
    // and type; errors already go to Sentry; the rest load extra scripts for
    // features this app doesn't use.
    disable_session_recording: true,
    capture_exceptions: false,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
  };
}
