import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted so references are available inside vi.mock factory
// ---------------------------------------------------------------------------

const { mockSet, mockGet } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: function (this: unknown) {
    return { set: mockSet, get: mockGet };
  },
}));

import {
  getVerificationCode,
  storeVerificationCode,
  verifyKey,
} from "../redis";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("verifyKey", () => {
  it("returns the prefixed lowercase email", () => {
    expect(verifyKey("user@example.com")).toBe("verify:user@example.com");
  });

  it("lowercases the email before adding the prefix", () => {
    expect(verifyKey("User@Example.COM")).toBe("verify:user@example.com");
  });

  it("handles already-lowercase emails without modification", () => {
    expect(verifyKey("test@test.com")).toBe("verify:test@test.com");
  });
});

describe("storeVerificationCode", () => {
  it("calls redis.set with the correct key, code, and 15-minute TTL", async () => {
    await storeVerificationCode("test@example.com", "123456");
    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith(
      "verify:test@example.com",
      "123456",
      { ex: 900 },
    );
  });

  it("lowercases the email in the stored key", async () => {
    await storeVerificationCode("CAPS@EXAMPLE.COM", "789012");
    expect(mockSet).toHaveBeenCalledWith(
      "verify:caps@example.com",
      "789012",
      { ex: 900 },
    );
  });
});

describe("getVerificationCode", () => {
  it("calls redis.get with the correct prefixed key", async () => {
    mockGet.mockResolvedValue("654321");
    const result = await getVerificationCode("test@example.com");
    expect(mockGet).toHaveBeenCalledOnce();
    expect(mockGet).toHaveBeenCalledWith("verify:test@example.com");
    expect(result).toBe("654321");
  });

  it("returns null when no verification code is stored", async () => {
    mockGet.mockResolvedValue(null);
    const result = await getVerificationCode("notfound@example.com");
    expect(result).toBeNull();
  });

  it("lowercases the email when building the lookup key", async () => {
    mockGet.mockResolvedValue("111222");
    await getVerificationCode("UPPER@CASE.COM");
    expect(mockGet).toHaveBeenCalledWith("verify:upper@case.com");
  });
});

describe("module initialization", () => {
  it("throws when UPSTASH_REDIS_REST_URL environment variable is missing", async () => {
    const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    vi.resetModules();

    await expect(import("../redis")).rejects.toThrow(
      /Missing UPSTASH_REDIS_REST_URL/,
    );

    process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    vi.resetModules();
  });

  it("throws when UPSTASH_REDIS_REST_TOKEN environment variable is missing", async () => {
    const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();

    await expect(import("../redis")).rejects.toThrow(
      /Missing UPSTASH_REDIS_REST_URL/,
    );

    process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    vi.resetModules();
  });
});
