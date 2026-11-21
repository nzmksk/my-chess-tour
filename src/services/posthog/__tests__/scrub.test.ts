import { describe, expect, it } from "vitest";
import type { CaptureResult } from "posthog-js";
import { createBeforeSend, scrubReferrer, scrubUrl } from "../scrub";

const SITE = "https://www.mychesstour.com";

describe("scrubUrl", () => {
  it("leaves an ordinary page URL alone", () => {
    expect(scrubUrl(`${SITE}/tournaments/kl-open-2026?tab=prizes`)).toBe(
      `${SITE}/tournaments/kl-open-2026?tab=prizes`,
    );
  });

  it("drops query parameters that are not allowlisted", () => {
    expect(
      scrubUrl(
        `${SITE}/auth/login?redirectTo=%2Fmy&message=bad+password&utm_source=ig`,
      ),
    ).toBe(`${SITE}/auth/login?utm_source=ig`);
  });

  it("drops auth codes and token hashes", () => {
    expect(
      scrubUrl(`${SITE}/auth/update-password?code=abc&token_hash=def`),
    ).toBe(`${SITE}/auth/update-password`);
  });

  it("drops the fragment, where Supabase puts session tokens", () => {
    expect(
      scrubUrl(`${SITE}/auth/update-password#access_token=eyJ&type=recovery`),
    ).toBe(`${SITE}/auth/update-password`);
  });

  it("masks invitation tokens in the path", () => {
    expect(scrubUrl(`${SITE}/invitations/9f8e7d6c5b4a`)).toBe(
      `${SITE}/invitations/:token`,
    );
  });

  it("scrubs bare paths too", () => {
    expect(scrubUrl("/invitations/9f8e7d6c5b4a")).toBe("/invitations/:token");
    expect(scrubUrl("/?status=open&q=ahmad")).toBe("/?status=open");
    expect(scrubUrl("/my")).toBe("/my");
  });

  it("returns values that are not URLs unchanged", () => {
    expect(scrubUrl("$direct")).toBe("$direct");
    expect(scrubUrl("")).toBe("");
  });
});

describe("scrubReferrer", () => {
  it("scrubs a referrer from this site like any other URL", () => {
    expect(scrubReferrer(`${SITE}/invitations/abc?next=%2Fmy`, SITE)).toBe(
      `${SITE}/invitations/:token`,
    );
  });

  it("cuts a referrer from another site down to its origin", () => {
    expect(
      scrubReferrer("https://gate.chip-in.asia/p/0d1e2f3a/?lang=en", SITE),
    ).toBe("https://gate.chip-in.asia/");
  });

  it("leaves $direct alone", () => {
    expect(scrubReferrer("$direct", SITE)).toBe("$direct");
  });
});

describe("createBeforeSend", () => {
  const beforeSend = createBeforeSend("staging", SITE);

  function event(overrides: Partial<CaptureResult> = {}): CaptureResult {
    return {
      uuid: "u",
      event: "$pageview",
      properties: {},
      ...overrides,
    };
  }

  it("scrubs URL and referrer properties and tags the environment", () => {
    const result = beforeSend(
      event({
        properties: {
          $current_url: `${SITE}/invitations/abc`,
          $pathname: "/invitations/abc",
          $referrer: "https://mail.google.com/mail/u/0/#inbox/xyz",
          $prev_pageview_pathname: "/auth/login",
          $browser: "Chrome",
        },
      }),
    );

    expect(result?.properties).toEqual({
      $current_url: `${SITE}/invitations/:token`,
      $pathname: "/invitations/:token",
      $referrer: "https://mail.google.com/",
      $prev_pageview_pathname: "/auth/login",
      $browser: "Chrome",
      environment: "staging",
    });
  });

  it("scrubs the person-property copies as well", () => {
    const result = beforeSend(
      event({
        $set_once: {
          $initial_current_url: `${SITE}/auth/update-password#access_token=x`,
          $initial_referrer: "https://gate.chip-in.asia/p/123/",
        },
        $set: { $current_url: `${SITE}/?code=abc` },
      }),
    );

    expect(result?.$set_once).toEqual({
      $initial_current_url: `${SITE}/auth/update-password`,
      $initial_referrer: "https://gate.chip-in.asia/",
    });
    expect(result?.$set).toEqual({ $current_url: `${SITE}/` });
  });

  it("passes a dropped event through", () => {
    expect(beforeSend(null)).toBeNull();
  });
});
