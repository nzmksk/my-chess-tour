import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: mockGet }),
}));

// next/font/google is a Next.js build-time feature that cannot run in vitest's
// Node environment — stub it so layout.tsx can be imported.
vi.mock("next/font/google", () => ({
  Cinzel: () => ({ variable: "--font-cinzel" }),
  Lato: () => ({ variable: "--font-lato" }),
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

  it("returns the exact title", async () => {
    mockGet.mockReturnValue("example.com");
    const meta = await generateMetadata();
    expect(meta.title).toBe("MY Chess Tour — Coming Soon");
  });

  it("returns the exact description", async () => {
    mockGet.mockReturnValue("example.com");
    const meta = await generateMetadata();
    expect(meta.description).toBe(
      "Malaysia's premier competitive chess circuit. Join the waitlist.",
    );
  });

  it("includes the svg icon path", async () => {
    mockGet.mockReturnValue("example.com");
    const meta = await generateMetadata();
    expect((meta.icons as { icon: string }).icon).toBe("/mct-logo-square.svg");
  });
});
