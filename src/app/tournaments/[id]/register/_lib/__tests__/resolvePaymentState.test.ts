import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, mockGetChipPurchase, setResults } = vi.hoisted(
  () => {
    function makeBuilder(getResult: () => unknown) {
      const b: Record<string, unknown> = {};
      for (const m of [
        "select",
        "eq",
        "order",
        "limit",
        "single",
        "maybeSingle",
      ]) {
        b[m] = vi.fn(() => b);
      }
      b.then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) => Promise.resolve(getResult()).then(onfulfilled, onrejected);
      return b;
    }

    let registrationResult: unknown = { data: null, error: null };
    let paymentResult: unknown = { data: null, error: null };
    const setResults = (reg: unknown, pay: unknown) => {
      registrationResult = reg;
      paymentResult = pay;
    };

    const mockFrom = vi.fn((table: string) => {
      if (table === "registrations")
        return makeBuilder(() => registrationResult);
      if (table === "payments") return makeBuilder(() => paymentResult);
      return makeBuilder(() => ({ data: null, error: null }));
    });

    const mockRpc = vi.fn(
      (): Promise<{ data: unknown; error: unknown }> =>
        Promise.resolve({ data: null, error: null }),
    );
    const mockGetChipPurchase = vi.fn();
    return { mockFrom, mockRpc, mockGetChipPurchase, setResults };
  },
);

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

vi.mock("@/services/chip/chip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/chip/chip")>();
  return { ...actual, getChipPurchase: mockGetChipPurchase };
});

import { resolvePaymentState } from "../resolvePaymentState";

const TOURNAMENT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";

function makeRegistration(status: string) {
  return {
    id: "reg-uuid",
    user_id: USER_ID,
    tournament_id: TOURNAMENT_ID,
    fee_tier: "standard",
    status,
    registered_at: "2026-01-01T00:00:00Z",
    confirmed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
  };
}

beforeEach(() => {
  setResults({ data: null, error: null }, { data: null, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolvePaymentState", () => {
  it("returns 'none' when the user has no registration", async () => {
    setResults({ data: null, error: null }, { data: null, error: null });

    const result = await resolvePaymentState(TOURNAMENT_ID, USER_ID);

    expect(result.state).toBe("none");
    expect(result.registration).toBeNull();
    expect(mockGetChipPurchase).not.toHaveBeenCalled();
  });

  it("returns 'confirmed' without reconciling when already confirmed", async () => {
    setResults(
      { data: makeRegistration("confirmed"), error: null },
      { data: null, error: null },
    );

    const result = await resolvePaymentState(TOURNAMENT_ID, USER_ID);

    expect(result.state).toBe("confirmed");
    expect(mockGetChipPurchase).not.toHaveBeenCalled();
  });

  it("returns 'failed' for a failed_payment registration", async () => {
    setResults(
      { data: makeRegistration("failed_payment"), error: null },
      { data: null, error: null },
    );

    const result = await resolvePaymentState(TOURNAMENT_ID, USER_ID);

    expect(result.state).toBe("failed");
    expect(mockGetChipPurchase).not.toHaveBeenCalled();
  });

  it("reconciles a pending registration that CHIP reports as paid", async () => {
    setResults(
      { data: makeRegistration("pending_payment"), error: null },
      {
        data: {
          id: "pay-uuid",
          status: "pending",
          chip_transaction_id: "chip-1",
        },
        error: null,
      },
    );
    mockGetChipPurchase.mockResolvedValue({
      id: "chip-1",
      status: "paid",
      amountCents: 5500,
    });

    const result = await resolvePaymentState(TOURNAMENT_ID, USER_ID);

    expect(mockGetChipPurchase).toHaveBeenCalledWith("chip-1");
    expect(mockRpc).toHaveBeenCalledWith("settle_registration_payment", {
      p_payment_id: "pay-uuid",
      p_paid: true,
      p_amount_cents: 5500,
    });
    expect(result.state).toBe("confirmed");
  });

  it("stays 'pending' when settlement reports an amount mismatch", async () => {
    setResults(
      { data: makeRegistration("pending_payment"), error: null },
      {
        data: {
          id: "pay-uuid",
          status: "pending",
          chip_transaction_id: "chip-1",
        },
        error: null,
      },
    );
    mockGetChipPurchase.mockResolvedValue({
      id: "chip-1",
      status: "paid",
      amountCents: 9999,
    });
    mockRpc.mockResolvedValueOnce({
      data: { amount_mismatch: true },
      error: null,
    });

    const result = await resolvePaymentState(TOURNAMENT_ID, USER_ID);

    expect(result.state).toBe("pending");
  });

  it("reconciles a pending registration that CHIP reports as error -> failed", async () => {
    setResults(
      { data: makeRegistration("pending_payment"), error: null },
      {
        data: {
          id: "pay-uuid",
          status: "pending",
          chip_transaction_id: "chip-1",
        },
        error: null,
      },
    );
    mockGetChipPurchase.mockResolvedValue({
      id: "chip-1",
      status: "error",
      amountCents: null,
    });

    const result = await resolvePaymentState(TOURNAMENT_ID, USER_ID);

    expect(mockRpc).toHaveBeenCalledWith("settle_registration_payment", {
      p_payment_id: "pay-uuid",
      p_paid: false,
      p_amount_cents: null,
    });
    expect(result.state).toBe("failed");
  });

  it("stays 'pending' when CHIP is not yet terminal", async () => {
    setResults(
      { data: makeRegistration("pending_payment"), error: null },
      {
        data: {
          id: "pay-uuid",
          status: "pending",
          chip_transaction_id: "chip-1",
        },
        error: null,
      },
    );
    mockGetChipPurchase.mockResolvedValue({ id: "chip-1", status: "created" });

    const result = await resolvePaymentState(TOURNAMENT_ID, USER_ID);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.state).toBe("pending");
  });

  it("degrades to 'pending' when CHIP reconciliation throws", async () => {
    setResults(
      { data: makeRegistration("pending_payment"), error: null },
      {
        data: {
          id: "pay-uuid",
          status: "pending",
          chip_transaction_id: "chip-1",
        },
        error: null,
      },
    );
    mockGetChipPurchase.mockRejectedValue(new Error("network"));

    const result = await resolvePaymentState(TOURNAMENT_ID, USER_ID);

    expect(result.state).toBe("pending");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("stays 'pending' when there is no chip_transaction_id to reconcile", async () => {
    setResults(
      { data: makeRegistration("pending_payment"), error: null },
      {
        data: { id: "pay-uuid", status: "pending", chip_transaction_id: null },
        error: null,
      },
    );

    const result = await resolvePaymentState(TOURNAMENT_ID, USER_ID);

    expect(result.state).toBe("pending");
    expect(mockGetChipPurchase).not.toHaveBeenCalled();
  });
});
