import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/_components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/UpdatePasswordForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import UpdatePasswordPage from "../page";

describe("UpdatePasswordPage", () => {
  it("returns a non-null React element", () => {
    const result = UpdatePasswordPage();
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("has a min-h-screen container", () => {
    const result = UpdatePasswordPage() as Record<string, unknown>;
    const props = result.props as Record<string, unknown>;
    expect(props.className).toContain("min-h-screen");
  });

  it("exports metadata with title containing MY Chess Tour", async () => {
    const mod = await import("../page");
    expect(mod.metadata).toBeDefined();
    expect((mod.metadata as { title: string }).title).toContain("MY Chess Tour");
  });
});
