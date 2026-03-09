import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/_components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/ForgotPasswordForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import ForgotPasswordPage from "../page";

describe("ForgotPasswordPage", () => {
  it("returns a non-null React element", () => {
    const result = ForgotPasswordPage();
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("has a min-h-screen container", () => {
    const result = ForgotPasswordPage() as Record<string, unknown>;
    const props = result.props as Record<string, unknown>;
    expect(props.className).toContain("min-h-screen");
  });

  it("exports metadata with a title containing MY Chess Tour", async () => {
    const mod = await import("../page");
    expect(mod.metadata).toBeDefined();
    expect((mod.metadata as { title: string }).title).toContain("MY Chess Tour");
  });
});
