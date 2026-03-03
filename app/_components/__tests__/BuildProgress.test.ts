import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetIssueProgress = vi.hoisted(() => vi.fn());

vi.mock("@/lib/github", () => ({
  getIssueProgress: mockGetIssueProgress,
}));

import BuildProgress from "../BuildProgress";

describe("BuildProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetIssueProgress.mockResolvedValue(42);
  });

  it("calls getIssueProgress exactly once", async () => {
    await BuildProgress();
    expect(mockGetIssueProgress).toHaveBeenCalledOnce();
  });

  it("returns a non-null React element", async () => {
    const result = await BuildProgress();
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("renders a progressbar with aria-valuenow equal to the fetched percentage", async () => {
    mockGetIssueProgress.mockResolvedValue(65);
    const element = await BuildProgress();

    // React elements are plain objects — walk the tree to find the progressbar div
    function findProgressbar(node: unknown): Record<string, unknown> | null {
      if (!node || typeof node !== "object") return null;
      const el = node as Record<string, unknown>;
      if (el.props && (el.props as Record<string, unknown>).role === "progressbar")
        return el.props as Record<string, unknown>;
      const children = (el.props as Record<string, unknown> | undefined)?.children;
      if (!children) return null;
      for (const child of Array.isArray(children) ? children : [children]) {
        const found = findProgressbar(child);
        if (found) return found;
      }
      return null;
    }

    const bar = findProgressbar(element);
    expect(bar).not.toBeNull();
    expect(bar?.["aria-valuenow"]).toBe(65);
  });

  it("renders the percentage label text", async () => {
    mockGetIssueProgress.mockResolvedValue(73);
    const element = await BuildProgress();

    function containsText(node: unknown, target: string): boolean {
      if (typeof node === "string") return node.includes(target);
      if (typeof node === "number") return String(node).includes(target);
      if (!node || typeof node !== "object") return false;
      const children = (node as Record<string, unknown>)?.children;
      if (!children) return false;
      const arr = Array.isArray(children) ? children : [children];
      return arr.some((c) => containsText(c, target));
    }

    function searchProps(node: unknown, target: string): boolean {
      if (!node || typeof node !== "object") return false;
      const el = node as Record<string, unknown>;
      if (containsText(el.props, target)) return true;
      const children = (el.props as Record<string, unknown> | undefined)?.children;
      if (!children) return false;
      const arr = Array.isArray(children) ? children : [children];
      return arr.some((c) => searchProps(c, target));
    }

    expect(searchProps(element, "73")).toBe(true);
  });
});
