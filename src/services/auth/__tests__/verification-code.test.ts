import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockStartResendCooldown,
  mockStoreVerificationCode,
  mockClearResendCooldown,
  mockSendVerificationEmail,
} = vi.hoisted(() => ({
  mockStartResendCooldown: vi.fn(),
  mockStoreVerificationCode: vi.fn(),
  mockClearResendCooldown: vi.fn(),
  mockSendVerificationEmail: vi.fn(),
}));

vi.mock("@/services/redis/redis", () => ({
  startResendCooldown: mockStartResendCooldown,
  storeVerificationCode: mockStoreVerificationCode,
  clearResendCooldown: mockClearResendCooldown,
}));

vi.mock("@/services/email/email", () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

import { generateCode, sendSignupVerificationCode } from "../verification-code";

beforeEach(() => {
  vi.clearAllMocks();
  mockStartResendCooldown.mockResolvedValue(0);
  mockStoreVerificationCode.mockResolvedValue(undefined);
  mockClearResendCooldown.mockResolvedValue(undefined);
  mockSendVerificationEmail.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateCode", () => {
  it("returns a 6-character uppercase alphanumeric code", () => {
    const code = generateCode();
    expect(code).toHaveLength(6);
    expect(/^[A-Z0-9]{6}$/.test(code)).toBe(true);
  });
});

describe("sendSignupVerificationCode", () => {
  it("stores and emails a code when not on cooldown", async () => {
    await sendSignupVerificationCode("user@example.com");

    expect(mockStartResendCooldown).toHaveBeenCalledWith("user@example.com");
    expect(mockStoreVerificationCode).toHaveBeenCalledOnce();
    expect(mockSendVerificationEmail).toHaveBeenCalledOnce();
    expect(mockClearResendCooldown).not.toHaveBeenCalled();

    const [emailArg, codeArg] = mockSendVerificationEmail.mock.calls[0];
    expect(emailArg).toBe("user@example.com");
    expect(codeArg).toHaveLength(6);
  });

  it("passes the same code to store and send", async () => {
    await sendSignupVerificationCode("user@example.com");
    expect(mockStoreVerificationCode.mock.calls[0][1]).toBe(
      mockSendVerificationEmail.mock.calls[0][1],
    );
  });

  it("is a no-op while on cooldown", async () => {
    mockStartResendCooldown.mockResolvedValue(900);

    await sendSignupVerificationCode("user@example.com");

    expect(mockStoreVerificationCode).not.toHaveBeenCalled();
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it("clears the cooldown and rethrows when storing fails", async () => {
    mockStoreVerificationCode.mockRejectedValue(new Error("redis down"));

    await expect(
      sendSignupVerificationCode("user@example.com"),
    ).rejects.toThrow("redis down");

    expect(mockClearResendCooldown).toHaveBeenCalledWith("user@example.com");
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it("clears the cooldown and rethrows when sending fails", async () => {
    mockSendVerificationEmail.mockRejectedValue(new Error("smtp down"));

    await expect(
      sendSignupVerificationCode("user@example.com"),
    ).rejects.toThrow("smtp down");

    expect(mockClearResendCooldown).toHaveBeenCalledWith("user@example.com");
  });
});
