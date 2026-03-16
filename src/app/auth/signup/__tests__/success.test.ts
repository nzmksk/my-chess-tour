import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => ({
    type: "a",
    props: { href, children },
  }),
}));

import RegisterSuccessPage from "../success/page";

describe("RegisterSuccessPage", () => {
  it("returns a non-null React element", async () => {
    const result = await RegisterSuccessPage({});
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("has a min-h-screen container", async () => {
    const result = (await RegisterSuccessPage({})) as Record<string, unknown>;
    const props = result.props as Record<string, unknown>;
    expect(props.className).toContain("min-h-screen");
  });

  it("exports metadata with title containing MY Chess Tour", async () => {
    const mod = await import("../success/page");
    expect(mod.metadata).toBeDefined();
    expect((mod.metadata as { title: string }).title).toContain("MY Chess Tour");
  });

  it("renders default name when no searchParams provided", async () => {
    const result = await RegisterSuccessPage({});
    function collectText(node: unknown): string {
      if (typeof node === "string") return node;
      if (typeof node === "number") return String(node);
      if (!node || typeof node !== "object") return "";
      const el = node as Record<string, unknown>;
      const children = (el.props as Record<string, unknown> | undefined)?.children;
      if (!children) return "";
      const arr = Array.isArray(children) ? children : [children];
      return arr.map(collectText).join("");
    }
    const text = collectText(result);
    expect(text).toContain("Player");
  });

  it("renders session info with member since", async () => {
    const result = await RegisterSuccessPage({});
    function collectText(node: unknown): string {
      if (typeof node === "string") return node;
      if (typeof node === "number") return String(node);
      if (!node || typeof node !== "object") return "";
      const el = node as Record<string, unknown>;
      const children = (el.props as Record<string, unknown> | undefined)?.children;
      if (!children) return "";
      const arr = Array.isArray(children) ? children : [children];
      return arr.map(collectText).join("");
    }
    const text = collectText(result);
    expect(text).toContain("Member since");
  });
});
