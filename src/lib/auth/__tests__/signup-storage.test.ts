// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  rememberSignupReturnTo,
  safeReturnPath,
  SIGNUP_RETURN_TO_STORAGE_KEY,
  takeSignupReturnTo,
} from "../signup-storage";

beforeEach(() => {
  sessionStorage.clear();
});

describe("safeReturnPath", () => {
  it("keeps a path on this site", () => {
    expect(safeReturnPath("/invitations/abc")).toBe("/invitations/abc");
  });

  it.each([
    ["an absolute URL", "https://evil.example/x"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["a relative path", "invitations/abc"],
    ["nothing", null],
  ])("rejects %s", (_label, value) => {
    expect(safeReturnPath(value)).toBeNull();
  });
});

describe("signup return path", () => {
  it("is returned once and then forgotten", () => {
    rememberSignupReturnTo("/invitations/abc");
    expect(takeSignupReturnTo()).toBe("/invitations/abc");
    expect(takeSignupReturnTo()).toBeNull();
  });

  it("is never stored when unsafe", () => {
    rememberSignupReturnTo("//evil.example");
    expect(sessionStorage.getItem(SIGNUP_RETURN_TO_STORAGE_KEY)).toBeNull();
  });

  it("is not followed if storage was tampered with", () => {
    sessionStorage.setItem(SIGNUP_RETURN_TO_STORAGE_KEY, "https://evil.example");
    expect(takeSignupReturnTo()).toBeNull();
  });
});
