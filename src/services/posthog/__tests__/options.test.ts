import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureResult } from "posthog-js";
import { posthogOptions } from "../options";

const SITE = "https://www.mychesstour.com";

describe("posthogOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs without cookies or browser storage", () => {
    expect(posthogOptions(SITE).cookieless_mode).toBe("always");
  });

  it("keeps session replay and exception capture off", () => {
    const options = posthogOptions(SITE);
    expect(options.disable_session_recording).toBe(true);
    expect(options.capture_exceptions).toBe(false);
    expect(options.mask_all_text).toBe(true);
  });

  it("defaults to PostHog Cloud US and honours an override", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
    expect(posthogOptions(SITE).api_host).toBe("https://us.i.posthog.com");

    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
    expect(posthogOptions(SITE).api_host).toBe("https://eu.i.posthog.com");
  });

  it("tags events with the deploy environment", () => {
    vi.stubEnv("NEXT_PUBLIC_ENVIRONMENT", "staging");
    const beforeSend = posthogOptions(SITE).before_send as (
      event: CaptureResult,
    ) => CaptureResult;

    const result = beforeSend({
      uuid: "u",
      event: "$pageview",
      properties: { $current_url: `${SITE}/invitations/abc` },
    });

    expect(result.properties).toEqual({
      $current_url: `${SITE}/invitations/:token`,
      environment: "staging",
    });
  });
});
