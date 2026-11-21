import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockList, mockRemove } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockRemove: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    storage: { from: vi.fn(() => ({ list: mockList, remove: mockRemove })) },
  },
}));

import { removeAllUnder } from "../storage";

const file = (name: string) => ({ id: `id-${name}`, name });
const folder = (name: string) => ({ id: null, name });
const page = (entries: unknown[]) => ({ data: entries, error: null });

function removeSucceeds() {
  mockRemove.mockImplementation(async (paths: string[]) => ({
    data: paths.map((name) => ({ name })),
    error: null,
  }));
}

describe("removeAllUnder", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockRemove.mockReset();
    removeSucceeds();
  });

  it("does nothing for an empty prefix", async () => {
    mockList.mockResolvedValueOnce(page([]));
    expect(await removeAllUnder("b", "users/u")).toBeNull();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("keeps listing until the prefix is empty, past the 1,000-entry page", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => file(`${i}.png`));
    mockList
      .mockResolvedValueOnce(page(full))
      .mockResolvedValueOnce(page([file("1000.png"), file("1001.png")]))
      .mockResolvedValueOnce(page([]));

    expect(await removeAllUnder("b", "users/u")).toBeNull();
    expect(mockList).toHaveBeenCalledWith("users/u", { limit: 1000 });
    expect(mockRemove).toHaveBeenCalledTimes(2);
    expect(mockRemove.mock.calls[0][0]).toHaveLength(1000);
    expect(mockRemove.mock.calls[1][0]).toEqual([
      "users/u/1000.png",
      "users/u/1001.png",
    ]);
  });

  it("recurses into sub-folders, wherever the files are", async () => {
    const objects = new Set([
      "users/u/oku/1.png",
      "users/u/oku/deep/x.pdf",
      "users/u/elsewhere.webp",
    ]);
    mockList.mockImplementation(async (prefix: string) => {
      const children = new Map<string, { id: string | null; name: string }>();
      for (const path of objects) {
        if (!path.startsWith(`${prefix}/`)) continue;
        const [head, ...rest] = path.slice(prefix.length + 1).split("/");
        children.set(head, rest.length ? folder(head) : file(head));
      }
      return page([...children.values()]);
    });
    mockRemove.mockImplementation(async (paths: string[]) => {
      paths.forEach((path) => objects.delete(path));
      return { data: paths.map((name) => ({ name })), error: null };
    });

    expect(await removeAllUnder("b", "users/u")).toBeNull();
    expect(objects.size).toBe(0);
  });

  it("returns the list error", async () => {
    mockList.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await removeAllUnder("b", "users/u")).toEqual({ message: "boom" });
  });

  it("returns the remove error", async () => {
    mockList.mockResolvedValueOnce(page([file("1.png")]));
    mockRemove.mockResolvedValueOnce({
      data: null,
      error: { message: "nope" },
    });
    expect(await removeAllUnder("b", "users/u")).toEqual({ message: "nope" });
  });

  it("stops with an error when a pass removes nothing, instead of looping", async () => {
    mockList.mockResolvedValue(page([file("stuck.png")]));
    mockRemove.mockResolvedValue({ data: [], error: null });
    const result = await removeAllUnder("b", "users/u");
    expect(result?.message).toMatch(/no objects removed/);
    expect(mockList).toHaveBeenCalledTimes(1);
  });
});
