import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCountHit,
  mockPeekCount,
  mockResetCount,
  mockTtl,
  mockSet,
  mockDel,
} = vi.hoisted(() => ({
  mockCountHit: vi.fn(),
  mockPeekCount: vi.fn(),
  mockResetCount: vi.fn(),
  mockTtl: vi.fn(),
  mockSet: vi.fn(),
  mockDel: vi.fn(),
}));

vi.mock("@/services/redis/redis", () => ({
  redis: { ttl: mockTtl, set: mockSet, del: mockDel },
  VERIFY_TTL_SECONDS: 900,
}));

vi.mock("../window", () => ({
  countHit: mockCountHit,
  peekCount: mockPeekCount,
  resetCount: mockResetCount,
}));

import {
  clearLoginAttempts,
  clearResendCooldown,
  getLoginLock,
  getVerifyAttempts,
  LOGIN_LOCK_SECONDS,
  MAX_LOGIN_ATTEMPTS,
  MAX_VERIFY_ATTEMPTS,
  recordLoginFailure,
  recordVerifyAttempt,
  resetVerifyAttempts,
  startResendCooldown,
} from "../auth";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("thresholds", () => {
  it("keeps the existing auth limits", () => {
    expect(MAX_VERIFY_ATTEMPTS).toBe(5);
    expect(MAX_LOGIN_ATTEMPTS).toBe(5);
    expect(LOGIN_LOCK_SECONDS).toBe(15 * 60);
  });
});

describe("startResendCooldown", () => {
  it("returns 0 and starts a 15-minute window on the first send", async () => {
    mockCountHit.mockResolvedValue({ count: 1, ttl: 900 });
    expect(await startResendCooldown("User@Example.com")).toBe(0);
    expect(mockCountHit).toHaveBeenCalledWith(
      "resend-cooldown:user@example.com",
      900,
    );
  });

  it("returns the seconds left while on cooldown", async () => {
    mockCountHit.mockResolvedValue({ count: 2, ttl: 600 });
    expect(await startResendCooldown("user@example.com")).toBe(600);
  });
});

describe("clearResendCooldown", () => {
  it("drops the cooldown counter", async () => {
    await clearResendCooldown("user@example.com");
    expect(mockResetCount).toHaveBeenCalledWith(
      "resend-cooldown:user@example.com",
    );
  });
});

describe("verify attempts", () => {
  it("counts a wrong code in the code's window and returns the total", async () => {
    mockCountHit.mockResolvedValue({ count: 3, ttl: 800 });
    expect(await recordVerifyAttempt("user@example.com")).toBe(3);
    expect(mockCountHit).toHaveBeenCalledWith(
      "verify-attempts:user@example.com",
      900,
    );
  });

  it("reads and resets the counter", async () => {
    mockPeekCount.mockResolvedValue(2);
    expect(await getVerifyAttempts("user@example.com")).toBe(2);
    expect(mockPeekCount).toHaveBeenCalledWith(
      "verify-attempts:user@example.com",
    );

    await resetVerifyAttempts("user@example.com");
    expect(mockResetCount).toHaveBeenCalledWith(
      "verify-attempts:user@example.com",
    );
  });
});

describe("getLoginLock", () => {
  it("returns 0 when there is no lock", async () => {
    mockTtl.mockResolvedValue(-2);
    expect(await getLoginLock("User@Example.com")).toBe(0);
    expect(mockTtl).toHaveBeenCalledWith("login:lock:user@example.com");
  });

  it("returns the seconds left on a lock", async () => {
    mockTtl.mockResolvedValue(840);
    expect(await getLoginLock("user@example.com")).toBe(840);
  });

  it("treats a lock with no expiry as a full lockout", async () => {
    mockTtl.mockResolvedValue(-1);
    expect(await getLoginLock("user@example.com")).toBe(LOGIN_LOCK_SECONDS);
  });
});

describe("recordLoginFailure", () => {
  it("returns the attempts left without locking", async () => {
    mockCountHit.mockResolvedValue({ count: 3, ttl: 700 });
    expect(await recordLoginFailure("User@Example.com")).toBe(2);
    expect(mockCountHit).toHaveBeenCalledWith(
      "login:attempts:user@example.com",
      LOGIN_LOCK_SECONDS,
    );
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("locks the email on the 5th failure and drops the counter", async () => {
    mockCountHit.mockResolvedValue({ count: 5, ttl: 700 });
    expect(await recordLoginFailure("user@example.com")).toBe(0);
    expect(mockSet).toHaveBeenCalledWith("login:lock:user@example.com", 1, {
      ex: LOGIN_LOCK_SECONDS,
    });
    expect(mockResetCount).toHaveBeenCalledWith(
      "login:attempts:user@example.com",
    );
  });
});

describe("clearLoginAttempts", () => {
  it("drops both the counter and the lock", async () => {
    await clearLoginAttempts("User@Example.com");
    expect(mockDel).toHaveBeenCalledWith(
      "login:attempts:user@example.com",
      "login:lock:user@example.com",
    );
  });
});
