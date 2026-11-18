import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExec, mockIncr, mockExpire, mockTtl, mockGet, mockDel } =
  vi.hoisted(() => ({
    mockExec: vi.fn(),
    mockIncr: vi.fn(),
    mockExpire: vi.fn(),
    mockTtl: vi.fn(),
    mockGet: vi.fn(),
    mockDel: vi.fn(),
  }));

// The test setup stubs this module for every other test.
vi.unmock("@/services/rate-limit/window");

vi.mock("@/services/redis/redis", () => {
  const tx = {
    incr: (...args: unknown[]) => (mockIncr(...args), tx),
    expire: (...args: unknown[]) => (mockExpire(...args), tx),
    ttl: (...args: unknown[]) => (mockTtl(...args), tx),
    exec: mockExec,
  };
  return { redis: { multi: () => tx, get: mockGet, del: mockDel } };
});

import { countHit, hitWindow, peekCount, resetCount } from "../window";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("countHit", () => {
  it("increments, starts the window only on the first hit, and reads the TTL in one transaction", async () => {
    mockExec.mockResolvedValue([1, 1, 600]);

    expect(await countHit("k", 600)).toEqual({ count: 1, ttl: 600 });
    expect(mockIncr).toHaveBeenCalledWith("k");
    expect(mockExpire).toHaveBeenCalledWith("k", 600, "nx");
    expect(mockTtl).toHaveBeenCalledWith("k");
    expect(mockExec).toHaveBeenCalledOnce();
  });

  it("falls back to the full window when the key has no TTL", async () => {
    mockExec.mockResolvedValue([4, 0, -1]);
    expect(await countHit("k", 600)).toEqual({ count: 4, ttl: 600 });
  });

  it("propagates Redis failures", async () => {
    mockExec.mockRejectedValue(new Error("redis down"));
    await expect(countHit("k", 600)).rejects.toThrow("redis down");
  });
});

describe("hitWindow", () => {
  it("returns 0 while the count is within the limit", async () => {
    mockExec.mockResolvedValue([5, 0, 120]);
    expect(await hitWindow("k", 5, 600)).toBe(0);
  });

  it("returns the seconds left in the window once over the limit", async () => {
    mockExec.mockResolvedValue([6, 0, 120]);
    expect(await hitWindow("k", 5, 600)).toBe(120);
  });
});

describe("peekCount / resetCount", () => {
  it("reads a counter without counting, defaulting to 0", async () => {
    mockGet.mockResolvedValueOnce(3).mockResolvedValueOnce(null);
    expect(await peekCount("k")).toBe(3);
    expect(await peekCount("k")).toBe(0);
    expect(mockIncr).not.toHaveBeenCalled();
  });

  it("deletes the counter", async () => {
    await resetCount("k");
    expect(mockDel).toHaveBeenCalledWith("k");
  });
});
