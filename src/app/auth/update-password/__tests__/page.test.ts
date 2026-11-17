import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("../_components/UpdatePasswordForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import UpdatePasswordPage from "../page";

const render = async (searchParams: { invite?: string } = {}) =>
  (await UpdatePasswordPage({
    searchParams: Promise.resolve(searchParams),
  })) as unknown as {
    props: { className: string; children: { props: Record<string, unknown> }[] };
  };

describe("UpdatePasswordPage", () => {
  it("returns a non-null React element", async () => {
    const result = await render();
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("has a min-h-screen container", async () => {
    const result = await render();
    expect(result.props.className).toContain("min-h-screen");
  });

  it("renders the reset form by default", async () => {
    const result = await render();
    expect(result.props.children[1].props.invited).toBe(false);
  });

  it("renders the invite wording for ?invite=1", async () => {
    const result = await render({ invite: "1" });
    expect(result.props.children[1].props.invited).toBe(true);
  });

  it("exports metadata with title containing MY Chess Tour", async () => {
    const mod = await import("../page");
    expect(mod.metadata).toBeDefined();
    expect((mod.metadata as { title: string }).title).toContain(
      "MY Chess Tour",
    );
  });
});
