import type { PostHogConfig } from "posthog-js";
import { createBeforeSend } from "./scrub";

export const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

const DEFAULT_API_HOST = "https://us.i.posthog.com";

export function posthogOptions(siteOrigin: string): Partial<PostHogConfig> {
  return {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_API_HOST,
    defaults: "2026-08-30",

    cookieless_mode: "always",
    person_profiles: "identified_only",
    respect_dnt: true,

    mask_all_text: true,
    before_send: createBeforeSend(
      process.env.NEXT_PUBLIC_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
      siteOrigin,
    ),

    disable_session_recording: true,
    capture_exceptions: false,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
  };
}
