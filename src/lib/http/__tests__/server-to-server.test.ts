import { describe, expect, it } from "vitest";
import { isBrowserApiPath, isServerToServerPath } from "../server-to-server";

describe("isServerToServerPath", () => {
  it.each([
    ["/api/v1/webhooks/chip", true],
    ["/api/v1/webhooks/chip/send", true],
    ["/api/v1/cron/refunds", true],
    ["/api/v1/tournaments", false],
    ["/api/v1/webhooksx", false],
    ["/tournaments/merdeka-open", false],
  ])("%s → %s", (pathname, expected) => {
    expect(isServerToServerPath(pathname)).toBe(expected);
  });
});

describe("isBrowserApiPath", () => {
  it.each([
    ["/api/v1/tournaments", true],
    ["/api/v1/profile", true],
    ["/api/v1/webhooks/chip", false],
    ["/api/v1/cron/payouts", false],
    ["/settings", false],
  ])("%s → %s", (pathname, expected) => {
    expect(isBrowserApiPath(pathname)).toBe(expected);
  });
});
