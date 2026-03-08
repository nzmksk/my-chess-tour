import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const { mockSet, mockGet } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(function () { return { set: mockSet, get: mockGet }; }),
}));

import { getVerificationCode, storeVerificationCode, verifyKey } from "../redis";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("lib/redis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- verifyKey ------------------------------------------------------------

  describe("verifyKey", () => {
    it("prefixes email with 'verify:'", () => {
      expect(verifyKey("player@example.com")).toBe("verify:player@example.com");
    });

    it("lowercases the email", () => {
      expect(verifyKey("Player@Example.COM")).toBe("verify:player@example.com");
    });
  });

  // --- storeVerificationCode ------------------------------------------------

  describe("storeVerificationCode", () => {
    it("calls redis.set with the verify key", async () => {
      mockSet.mockResolvedValue("OK");

      await storeVerificationCode("player@example.com", "ABC123");

      expect(mockSet).toHaveBeenCalledWith(
        "verify:player@example.com",
        "ABC123",
        { ex: 600 }
      );
    });

    it("stores with a 600-second TTL", async () => {
      mockSet.mockResolvedValue("OK");

      await storeVerificationCode("player@example.com", "ABC123");

      const [, , options] = mockSet.mock.calls[0];
      expect(options.ex).toBe(600);
    });

    it("lowercases the email when building the key", async () => {
      mockSet.mockResolvedValue("OK");

      await storeVerificationCode("PLAYER@EXAMPLE.COM", "XYZ999");

      expect(mockSet).toHaveBeenCalledWith(
        "verify:player@example.com",
        "XYZ999",
        expect.any(Object)
      );
    });
  });

  // --- getVerificationCode --------------------------------------------------

  describe("getVerificationCode", () => {
    it("returns the stored code", async () => {
      mockGet.mockResolvedValue("ABC123");

      const result = await getVerificationCode("player@example.com");

      expect(result).toBe("ABC123");
      expect(mockGet).toHaveBeenCalledWith("verify:player@example.com");
    });

    it("returns null when code is not found", async () => {
      mockGet.mockResolvedValue(null);

      const result = await getVerificationCode("player@example.com");

      expect(result).toBeNull();
    });

    it("lowercases the email when building the key", async () => {
      mockGet.mockResolvedValue("ABC123");

      await getVerificationCode("PLAYER@EXAMPLE.COM");

      expect(mockGet).toHaveBeenCalledWith("verify:player@example.com");
    });
  });
});
