import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => ({ type: "a", props: { href, children } }),
}));

vi.mock("@/lib/auth-validation", async () => {
  const actual = await import("@/lib/auth-validation");
  return actual;
});

vi.mock("../StepTracker", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import RegisterForm from "../SignUpForm";

describe("RegisterForm", () => {
  it("is defined as a function", () => {
    expect(typeof RegisterForm).toBe("function");
  });

  it("has a default export", () => {
    expect(RegisterForm).toBeDefined();
  });

  it("is named RegisterForm", () => {
    expect(RegisterForm.name).toBe("RegisterForm");
  });
});
