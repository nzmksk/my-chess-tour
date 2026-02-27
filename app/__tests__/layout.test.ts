import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: mockGet }),
}));

import { generateMetadata } from "../layout";

describe("generateMetadata", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([["admin.mychessour.com"], ["staging.mychessour.com"]])(
    "returns noindex for %s",
    async (host) => {
      mockGet.mockReturnValue(host);
      const meta = await generateMetadata();
      expect(meta.robots).toEqual({ index: false, follow: false });
    }
  );

  it.each([["mychessour.com"], ["www.mychessour.com"]])(
    "returns index:true for %s",
    async (host) => {
      mockGet.mockReturnValue(host);
      const meta = await generateMetadata();
      expect(meta.robots).toEqual({ index: true, follow: true });
    }
  );

  it("returns index:true when host header is absent", async () => {
    mockGet.mockReturnValue(null);
    const meta = await generateMetadata();
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("returns title containing 'MY Chess Tour'", async () => {
    mockGet.mockReturnValue("example.com");
    const meta = await generateMetadata();
    expect(String(meta.title)).toContain("MY Chess Tour");
  });

  it("returns a non-empty description", async () => {
    mockGet.mockReturnValue("example.com");
    const meta = await generateMetadata();
    expect(typeof meta.description).toBe("string");
    expect((meta.description as string).length).toBeGreaterThan(0);
  });
});
