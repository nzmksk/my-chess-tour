import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/_components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("next/link", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import SignedOutPage from "../page";

describe("SignedOutPage", () => {
  it("returns a non-null React element", () => {
    const result = SignedOutPage();
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("has a min-h-screen container", () => {
    const result = SignedOutPage() as Record<string, unknown>;
    const props = result.props as Record<string, unknown>;
    expect(props.className).toContain("min-h-screen");
  });

  it("exports metadata with a title containing MY Chess Tour", async () => {
    const mod = await import("../page");
    expect(mod.metadata).toBeDefined();
    expect((mod.metadata as { title: string }).title).toContain(
      "MY Chess Tour",
    );
  });
});
