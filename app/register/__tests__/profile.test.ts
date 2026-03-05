import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/_components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/ProfileForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/AuthCardSkeleton", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import RegisterProfilePage from "../profile/page";

describe("RegisterProfilePage", () => {
  it("returns a non-null React element", () => {
    const result = RegisterProfilePage();
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("has a min-h-screen container", () => {
    const result = RegisterProfilePage() as Record<string, unknown>;
    const props = result.props as Record<string, unknown>;
    expect(props.className).toContain("min-h-screen");
  });

  it("exports metadata with a title", async () => {
    const mod = await import("../profile/page");
    expect(mod.metadata).toBeDefined();
    expect((mod.metadata as { title: string }).title).toContain("MY Chess Tour");
  });
});
