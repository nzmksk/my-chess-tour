import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chipRefundOutcome,
  createChipPurchase,
  isChipRefundEvent,
  refundChipPurchase,
} from "../chip";

const CHIP_API_URL = "https://gate.chip-in.asia/api/v1";

describe("chipRefundOutcome", () => {
  it("maps refund success (event and status)", () => {
    expect(chipRefundOutcome(undefined, "payment.refunded")).toBe("refunded");
    expect(chipRefundOutcome("refunded")).toBe("refunded");
  });

  it("maps refund failure", () => {
    expect(chipRefundOutcome("error", "purchase.refund_failure")).toBe("failed");
  });

  it("treats everything else (incl. pending_refund) as pending", () => {
    expect(chipRefundOutcome("pending_refund", "purchase.pending_refund")).toBe(
      "pending",
    );
    expect(chipRefundOutcome()).toBe("pending");
    // A registration status must not be read as a refund outcome.
    expect(chipRefundOutcome("paid", "purchase.paid")).toBe("pending");
  });
});

describe("isChipRefundEvent", () => {
  it("recognises the three refund events", () => {
    expect(isChipRefundEvent("payment.refunded")).toBe(true);
    expect(isChipRefundEvent("purchase.refund_failure")).toBe(true);
    expect(isChipRefundEvent("purchase.pending_refund")).toBe(true);
  });

  it("recognises refund purchase statuses", () => {
    expect(isChipRefundEvent(undefined, "refunded")).toBe(true);
    expect(isChipRefundEvent(undefined, "pending_refund")).toBe(true);
  });

  it("is false for registration events", () => {
    expect(isChipRefundEvent("purchase.paid", "paid")).toBe(false);
    expect(isChipRefundEvent("purchase.payment_failure", "error")).toBe(false);
    expect(isChipRefundEvent()).toBe(false);
  });
});

describe("createChipPurchase", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("CHIP_API_KEY", "test-key");
    vi.stubEnv("CHIP_BRAND_ID", "test-brand");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("posts the caller's payload with brand_id injected", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "chip-1", checkout_url: "https://pay/1" }),
    });

    const result = await createChipPurchase({
      purchase: {
        currency: "MYR",
        products: [{ name: "Entry", price: 5500, quantity: "1" }],
      },
      client: { email: "player@example.com" },
      reference: "pay-1",
      success_redirect: "https://app/success",
      failure_redirect: "https://app/failure",
      send_receipt: true,
      due: 1_700_000_000,
    });

    expect(result).toEqual({ id: "chip-1", checkout_url: "https://pay/1" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${CHIP_API_URL}/purchases/`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      purchase: {
        currency: "MYR",
        products: [{ name: "Entry", price: 5500, quantity: "1" }],
      },
      client: { email: "player@example.com" },
      brand_id: "test-brand",
      reference: "pay-1",
      success_redirect: "https://app/success",
      failure_redirect: "https://app/failure",
      send_receipt: true,
      due: 1_700_000_000,
    });
  });

  it("throws on a non-OK response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "purchase_validation_error",
    });

    await expect(
      createChipPurchase({
        purchase: { products: [{ name: "Entry", price: 5500 }] },
        client: { email: "player@example.com" },
      }),
    ).rejects.toThrow("CHIP API error 422: purchase_validation_error");
  });

  it("throws when CHIP_BRAND_ID is not configured", async () => {
    vi.stubEnv("CHIP_BRAND_ID", "");
    await expect(
      createChipPurchase({
        purchase: { products: [{ name: "Entry", price: 5500 }] },
        client: { email: "player@example.com" },
      }),
    ).rejects.toThrow("CHIP_API_KEY and CHIP_BRAND_ID must be configured");
  });
});

describe("refundChipPurchase", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("CHIP_API_KEY", "test-key");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("issues a full refund with no body and returns id + status", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "refund-pay-1", status: "refunded" }),
    });

    const result = await refundChipPurchase("chip-orig-1");

    expect(result).toEqual({ id: "refund-pay-1", status: "refunded" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${CHIP_API_URL}/purchases/chip-orig-1/refund/`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
        body: undefined,
      }),
    );
  });

  it("sends the amount for a partial refund", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "refund-pay-2", status: "pending_refund" }),
    });

    await refundChipPurchase("chip-orig-2", 4200);

    expect(fetchMock).toHaveBeenCalledWith(
      `${CHIP_API_URL}/purchases/chip-orig-2/refund/`,
      expect.objectContaining({ body: JSON.stringify({ amount: 4200 }) }),
    );
  });

  it("throws on a non-OK response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "purchase_refund_error",
    });

    await expect(refundChipPurchase("chip-orig-3")).rejects.toThrow(
      "CHIP API error 400: purchase_refund_error",
    );
  });

  it("throws when CHIP_API_KEY is not configured", async () => {
    vi.stubEnv("CHIP_API_KEY", "");
    await expect(refundChipPurchase("chip-orig-4")).rejects.toThrow(
      "CHIP_API_KEY must be configured",
    );
  });
});
