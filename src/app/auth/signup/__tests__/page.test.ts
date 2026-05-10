import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/SignUpForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/AuthCardSkeleton", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import RegisterPage from "../page";

describe("RegisterPage", () => {
  it("returns a non-null React element", () => {
    const result = RegisterPage();
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("has a min-h-screen container", () => {
    const result = RegisterPage() as Record<string, unknown>;
    const props = result.props as Record<string, unknown>;
    expect(props.className).toContain("min-h-screen");
  });

  it("exports metadata with a title", async () => {
    const mod = await import("../page");
    expect(mod.metadata).toBeDefined();
    expect((mod.metadata as { title: string }).title).toContain("MY Chess Tour");
  });
});
