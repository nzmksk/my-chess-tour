import { describe, expect, it } from "vitest";
import { stripPersistence, SESSION_ONLY_COOKIE } from "../session-cookie";

describe("SESSION_ONLY_COOKIE", () => {
  it("has the expected cookie name", () => {
    expect(SESSION_ONLY_COOKIE).toBe("mct_session_only");
  });
});

describe("stripPersistence", () => {
  it("returns an empty array for empty input", () => {
    expect(stripPersistence([])).toEqual([]);
  });

  it("returns non-sb- cookies untouched (same reference)", () => {
    const cookie = {
      name: "other-cookie",
      value: "val",
      options: { maxAge: 3600 },
    };
    const result = stripPersistence([cookie]);
    expect(result[0]).toBe(cookie);
  });

  it("removes maxAge from sb- cookies", () => {
    const cookie = {
      name: "sb-token",
      value: "val",
      options: { maxAge: 3600, path: "/" },
    };
    const result = stripPersistence([cookie]);
    expect(result[0].options).not.toHaveProperty("maxAge");
    expect((result[0].options as Record<string, unknown>)?.path).toBe("/");
  });

  it("removes expires from sb- cookies", () => {
    const expiry = new Date();
    const cookie = {
      name: "sb-token",
      value: "val",
      options: { expires: expiry, path: "/" },
    };
    const result = stripPersistence([cookie]);
    expect(result[0].options).not.toHaveProperty("expires");
    expect((result[0].options as Record<string, unknown>)?.path).toBe("/");
  });

  it("handles sb- cookies with no options object", () => {
    const cookie = { name: "sb-token", value: "val" };
    const result = stripPersistence([cookie]);
    expect(result[0].options).not.toHaveProperty("maxAge");
    expect(result[0].options).not.toHaveProperty("expires");
  });

  it("does not mutate the original cookie's options", () => {
    const options = { maxAge: 3600, path: "/" };
    const cookie = { name: "sb-token", value: "val", options };
    stripPersistence([cookie]);
    expect(options.maxAge).toBe(3600);
  });

  it("processes mixed sb- and non-sb- cookies correctly", () => {
    const sbCookie = {
      name: "sb-auth",
      value: "tok",
      options: { maxAge: 3600 },
    };
    const otherCookie = {
      name: "theme",
      value: "dark",
      options: { maxAge: 86400 },
    };
    const result = stripPersistence([sbCookie, otherCookie]);
    expect(result[0].options).not.toHaveProperty("maxAge");
    expect(result[1]).toBe(otherCookie);
  });
});
