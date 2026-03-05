import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/_components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/VerifyForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/AuthCardSkeleton", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import RegisterVerifyPage from "../verify/page";

describe("RegisterVerifyPage", () => {
  it("returns a non-null React element", () => {
    const result = RegisterVerifyPage();
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("has a min-h-screen container", () => {
    const result = RegisterVerifyPage() as Record<string, unknown>;
    const props = result.props as Record<string, unknown>;
    expect(props.className).toContain("min-h-screen");
  });

  it("exports metadata with a title", async () => {
    const mod = await import("../verify/page");
    expect(mod.metadata).toBeDefined();
    expect((mod.metadata as { title: string }).title).toContain("MY Chess Tour");
  });
});
