import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/ForgotPasswordForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import ForgotPasswordPage from "../page";

describe("ForgotPasswordPage", () => {
  it("returns a non-null React element", async () => {
    const result = await ForgotPasswordPage({
      searchParams: Promise.resolve({}),
    });
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("has a min-h-screen container", async () => {
    const result = (await ForgotPasswordPage({
      searchParams: Promise.resolve({}),
    })) as unknown as Record<string, unknown>;
    const props = result.props as Record<string, unknown>;
    expect(props.className).toContain("min-h-screen");
  });

  it("maps the invalid_link error param to a friendly message", async () => {
    const result = (await ForgotPasswordPage({
      searchParams: Promise.resolve({ error: "invalid_link" }),
    })) as unknown as Record<string, unknown>;
    const outerProps = result.props as { children: unknown[] };
    const form = outerProps.children[1] as {
      props: { initialError: string | null };
    };
    expect(form.props.initialError).toMatch(/invalid or has expired/i);
  });

  it("passes null initialError for an unknown error param", async () => {
    const result = (await ForgotPasswordPage({
      searchParams: Promise.resolve({ error: "something_else" }),
    })) as unknown as Record<string, unknown>;
    const outerProps = result.props as { children: unknown[] };
    const form = outerProps.children[1] as {
      props: { initialError: string | null };
    };
    expect(form.props.initialError).toBeNull();
  });

  it("exports metadata with title 'Reset Password'", async () => {
    const mod = await import("../page");
    expect(mod.metadata).toBeDefined();
    expect((mod.metadata as { title: string }).title).toBe("Reset Password");
  });
});
