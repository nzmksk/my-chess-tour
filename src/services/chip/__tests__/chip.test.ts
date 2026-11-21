import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chipOutcome,
  chipRefundOutcome,
  cancelChipPurchase,
  createChipPurchase,
  getChipPurchase,
  isChipRefundEvent,
  refundChipPurchase,
} from "../chip";
import { isPendingRefund } from "../interfaces/refund-response";

const CHIP_API_URL = "https://gate.chip-in.asia/api/v1";

describe("chipOutcome", () => {
  it("maps paid, by status or by event", () => {
    expect(chipOutcome("paid")).toBe("paid");
    expect(chipOutcome(undefined, "purchase.paid")).toBe("paid");
    expect(chipOutcome(undefined, "purchase.captured")).toBe("paid");
  });

  it("treats cleared and settled, which only follow paid, as paid", () => {
    expect(chipOutcome("cleared")).toBe("paid");
    expect(chipOutcome("settled", "purchase.settled")).toBe("paid");
  });

  it("maps failures", () => {
    expect(chipOutcome("error", "purchase.payment_failure")).toBe("failed");
    expect(chipOutcome("cancelled", "purchase.cancelled")).toBe("failed");
  });

  it("treats expired and in-flight states as pending", () => {
    for (const s of ["created", "viewed", "expired", "pending_execute", undefined]) {
      expect(chipOutcome(s)).toBe("pending");
    }
  });
});

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

  it("issues a full refund with no body and returns the refund Payment", async () => {
    const payment = {
      type: "payment",
      id: "refund-pay-1",
      payment: { payment_type: "refund", is_outgoing: true, amount: 5500 },
      related_to: { type: "purchase", id: "chip-orig-1" },
    };
    fetchMock.mockResolvedValue({ ok: true, json: async () => payment });

    const result = await refundChipPurchase("chip-orig-1");

    expect(result).toEqual(payment);
    expect(isPendingRefund(result)).toBe(false);
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
      json: async () => ({ type: "payment", id: "refund-pay-2" }),
    });

    await refundChipPurchase("chip-orig-2", { amount: 4200 });

    expect(fetchMock).toHaveBeenCalledWith(
      `${CHIP_API_URL}/purchases/chip-orig-2/refund/`,
      expect.objectContaining({ body: JSON.stringify({ amount: 4200 }) }),
    );
  });

  it("returns the Purchase shape when the acquirer is still processing", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "chip-orig-5", status: "pending_refund" }),
    });

    const result = await refundChipPurchase("chip-orig-5");

    expect(isPendingRefund(result)).toBe(true);
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

describe("Collect retries and idempotency", () => {
  const fetchMock = vi.fn();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const ok = (body: unknown = { id: "refund-pay-1", type: "payment" }) => ({
    ok: true,
    status: 200,
    json: async () => body,
  });
  const fail = (status: number, headers: Record<string, string> = {}) => ({
    ok: false,
    status,
    headers: new Headers(headers),
    text: async () => `error ${status}`,
  });
  const keyOf = (call: number) =>
    (fetchMock.mock.calls[call][1].headers as Record<string, string>)[
      "Idempotency-Key"
    ];

  async function settle<T>(promise: Promise<T>): Promise<T> {
    const caught = promise.catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const result = await caught;
    if (result instanceof Error) throw result;
    return result as T;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("CHIP_API_KEY", "test-key");
    vi.stubEnv("CHIP_BRAND_ID", "test-brand");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("sends an Idempotency-Key on every write and none on a read", async () => {
    fetchMock.mockResolvedValue(ok());
    await createChipPurchase({
      purchase: { products: [{ name: "Entry", price: 5500 }] },
      client: { email: "player@example.com" },
    });
    await refundChipPurchase("chip-1");
    await cancelChipPurchase("chip-1");
    await getChipPurchase("chip-1");

    for (const call of [0, 1, 2]) expect(keyOf(call)).toMatch(UUID);
    expect(new Set([keyOf(0), keyOf(1), keyOf(2)]).size).toBe(3);
    expect(keyOf(3)).toBeUndefined();
  });

  it.each([500, 503])(
    "retries a %i with the same key, then succeeds",
    async (status) => {
      fetchMock.mockResolvedValueOnce(fail(status)).mockResolvedValueOnce(ok());
      await expect(settle(refundChipPurchase("chip-1"))).resolves.toEqual({
        id: "refund-pay-1",
        type: "payment",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(keyOf(1)).toBe(keyOf(0));
    },
  );

  it("retries a network failure with the same key", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok());
    await settle(refundChipPurchase("chip-1"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it("gives up after three attempts", async () => {
    fetchMock.mockResolvedValue(fail(500));
    await expect(settle(refundChipPurchase("chip-1"))).rejects.toThrow(
      "CHIP API error 500: error 500",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rethrows the network error after three attempts", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(settle(getChipPurchase("chip-1"))).rejects.toThrow(
      "fetch failed",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 404, 409, 422])(
    "does not retry a %i",
    async (status) => {
      fetchMock.mockResolvedValue(fail(status));
      await expect(settle(refundChipPurchase("chip-1"))).rejects.toThrow(
        `CHIP API error ${status}`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("does not retry a 502: the webhook decides", async () => {
    fetchMock.mockResolvedValue(fail(502));
    await expect(settle(refundChipPurchase("chip-1"))).rejects.toThrow(
      "CHIP API error 502",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits out a short Retry-After on a 429", async () => {
    fetchMock
      .mockResolvedValueOnce(fail(429, { "Retry-After": "1" }))
      .mockResolvedValueOnce(ok());
    const pending = refundChipPurchase("chip-1");
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it("backs off on a 429 with no Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok());
    await settle(refundChipPurchase("chip-1"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up at once when Retry-After is longer than a request can wait", async () => {
    fetchMock.mockResolvedValue(fail(429, { "Retry-After": "60" }));
    await expect(settle(refundChipPurchase("chip-1"))).rejects.toThrow(
      "CHIP API error 429",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
