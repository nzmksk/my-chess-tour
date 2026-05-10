import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => ({ type: "a", props: { href, children } }),
}));

vi.mock("@/lib/auth-validation", async () => {
  const actual = await import("@/services/auth/auth-validation");
  return actual;
});

vi.mock("../StepTracker", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import SignUpForm from "../SignUpForm";

describe("SignUpForm", () => {
  it("is defined as a function", () => {
    expect(typeof SignUpForm).toBe("function");
  });

  it("has a default export", () => {
    expect(SignUpForm).toBeDefined();
  });

  it("is named SignUpForm", () => {
    expect(SignUpForm.name).toBe("SignUpForm");
  });
});
