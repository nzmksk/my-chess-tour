import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted so references are available inside vi.mock factory
// ---------------------------------------------------------------------------

const { mockSet, mockGet, mockDel, mockTtl, mockIncr, mockExpire } = vi.hoisted(
  () => ({
    mockSet: vi.fn(),
    mockGet: vi.fn(),
    mockDel: vi.fn(),
    mockTtl: vi.fn(),
    mockIncr: vi.fn(),
    mockExpire: vi.fn(),
  }),
);

vi.mock("@upstash/redis", () => ({
  Redis: function (this: unknown) {
    return {
      set: mockSet,
      get: mockGet,
      del: mockDel,
      ttl: mockTtl,
      incr: mockIncr,
      expire: mockExpire,
    };
  },
}));

import {
  getVerificationCode,
  storeVerificationCode,
  verifyKey,
  deleteVerificationCode,
  startResendCooldown,
  clearResendCooldown,
  recordVerifyAttempt,
  getVerifyAttempts,
  resetVerifyAttempts,
  recordSignupAttempt,
  MAX_VERIFY_ATTEMPTS,
  MAX_SIGNUP_ATTEMPTS_PER_IP,
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
    expect(mockSet).toHaveBeenCalledWith("verify:test@example.com", "123456", {
      ex: 900,
    });
  });

  it("lowercases the email in the stored key", async () => {
    await storeVerificationCode("CAPS@EXAMPLE.COM", "789012");
    expect(mockSet).toHaveBeenCalledWith("verify:caps@example.com", "789012", {
      ex: 900,
    });
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

describe("deleteVerificationCode", () => {
  it("deletes the verify key", async () => {
    await deleteVerificationCode("Test@Example.com");
    expect(mockDel).toHaveBeenCalledWith("verify:test@example.com");
  });
});

describe("startResendCooldown", () => {
  it("returns 0 when the cooldown is freshly set (SET NX succeeds)", async () => {
    mockSet.mockResolvedValue("OK");
    const remaining = await startResendCooldown("user@example.com");
    expect(remaining).toBe(0);
    expect(mockSet).toHaveBeenCalledWith(
      "resend-cooldown:user@example.com",
      "1",
      {
        ex: 900,
        nx: true,
      },
    );
    expect(mockTtl).not.toHaveBeenCalled();
  });

  it("returns the remaining TTL when already on cooldown", async () => {
    mockSet.mockResolvedValue(null);
    mockTtl.mockResolvedValue(600);
    const remaining = await startResendCooldown("user@example.com");
    expect(remaining).toBe(600);
    expect(mockTtl).toHaveBeenCalledWith("resend-cooldown:user@example.com");
  });

  it("falls back to the full window when TTL is unavailable", async () => {
    mockSet.mockResolvedValue(null);
    mockTtl.mockResolvedValue(-1);
    const remaining = await startResendCooldown("user@example.com");
    expect(remaining).toBe(900);
  });
});

describe("clearResendCooldown", () => {
  it("deletes the cooldown key", async () => {
    await clearResendCooldown("user@example.com");
    expect(mockDel).toHaveBeenCalledWith("resend-cooldown:user@example.com");
  });
});

describe("recordVerifyAttempt", () => {
  it("sets the expiry on the first attempt and returns the count", async () => {
    mockIncr.mockResolvedValue(1);
    const count = await recordVerifyAttempt("user@example.com");
    expect(count).toBe(1);
    expect(mockIncr).toHaveBeenCalledWith("verify-attempts:user@example.com");
    expect(mockExpire).toHaveBeenCalledWith(
      "verify-attempts:user@example.com",
      900,
    );
  });

  it("does not re-set the expiry on subsequent attempts", async () => {
    mockIncr.mockResolvedValue(3);
    const count = await recordVerifyAttempt("user@example.com");
    expect(count).toBe(3);
    expect(mockExpire).not.toHaveBeenCalled();
  });
});

describe("getVerifyAttempts", () => {
  it("returns the stored count", async () => {
    mockGet.mockResolvedValue(2);
    expect(await getVerifyAttempts("user@example.com")).toBe(2);
  });

  it("returns 0 when no counter exists", async () => {
    mockGet.mockResolvedValue(null);
    expect(await getVerifyAttempts("user@example.com")).toBe(0);
  });
});

describe("resetVerifyAttempts", () => {
  it("deletes the attempts key", async () => {
    await resetVerifyAttempts("user@example.com");
    expect(mockDel).toHaveBeenCalledWith("verify-attempts:user@example.com");
  });
});

describe("recordSignupAttempt", () => {
  it("sets the window expiry on the first attempt", async () => {
    mockIncr.mockResolvedValue(1);
    const count = await recordSignupAttempt("1.2.3.4");
    expect(count).toBe(1);
    expect(mockIncr).toHaveBeenCalledWith("signup-ip:1.2.3.4");
    expect(mockExpire).toHaveBeenCalledWith("signup-ip:1.2.3.4", 600);
  });

  it("does not re-set the expiry on subsequent attempts", async () => {
    mockIncr.mockResolvedValue(7);
    const count = await recordSignupAttempt("1.2.3.4");
    expect(count).toBe(7);
    expect(mockExpire).not.toHaveBeenCalled();
  });
});

describe("rate-limit constants", () => {
  it("exposes the expected limits", () => {
    expect(MAX_VERIFY_ATTEMPTS).toBe(5);
    expect(MAX_SIGNUP_ATTEMPTS_PER_IP).toBe(30);
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
