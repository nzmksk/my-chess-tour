import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, tables, mockSendOutcome } = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "single"]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) =>
      Promise.resolve(tables[table]?.shift() ?? { data: null, error: null }).then(
        onfulfilled,
        onrejected,
      );
    return b;
  }

  return {
    tables,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockSendOutcome: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/email/email", () => ({
  sendRefundOutcomeEmail: mockSendOutcome,
}));

import { notifyRefundSettlement } from "../notify";

const REFUND = "55555555-5555-5555-5555-555555555555";

function givenRefund(overrides: Record<string, unknown> = {}) {
  tables.refunds = [
    {
      data: {
        refund_amount_cents: 11000,
        registration: {
          user: { email: "farid@example.com", first_name: "Farid" },
          tournament: { name: "KL Open" },
          payment: { payment_method: "razer_grabpay" },
        },
        ...overrides,
      },
      error: null,
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  mockSendOutcome.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("notifyRefundSettlement", () => {
  it("emails a completed refund when this call settled it", async () => {
    givenRefund();
    await notifyRefundSettlement(REFUND, { newly_settled: true, newly_failed: false });

    expect(mockSendOutcome).toHaveBeenCalledWith("farid@example.com", {
      playerName: "Farid",
      tournamentName: "KL Open",
      amountCents: 11000,
      paymentMethod: "GrabPay",
      completed: true,
    });
  });

  it("emails a failed refund when this call recorded the first failure", async () => {
    givenRefund();
    await notifyRefundSettlement(REFUND, { newly_settled: false, newly_failed: true });

    expect(mockSendOutcome).toHaveBeenCalledWith(
      "farid@example.com",
      expect.objectContaining({ completed: false }),
    );
  });

  it.each([
    ["an already-processed refund", { newly_settled: false, newly_failed: false }],
    ["a missing result", null],
    ["a result without the flags (older function)", {}],
  ])("sends nothing for %s", async (_label, result) => {
    givenRefund();
    await notifyRefundSettlement(REFUND, result);

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSendOutcome).not.toHaveBeenCalled();
  });

  it("falls back when the name, tournament and payment method are missing", async () => {
    givenRefund({
      registration: {
        user: { email: "farid@example.com", first_name: null },
        tournament: null,
        payment: null,
      },
    });
    await notifyRefundSettlement(REFUND, { newly_settled: true });

    expect(mockSendOutcome).toHaveBeenCalledWith("farid@example.com", {
      playerName: "Player",
      tournamentName: "your tournament",
      amountCents: 11000,
      paymentMethod: "your original payment method",
      completed: true,
    });
  });

  it("sends nothing when the player has no address", async () => {
    givenRefund({
      registration: { user: null, tournament: { name: "KL Open" }, payment: null },
    });
    await notifyRefundSettlement(REFUND, { newly_settled: true });

    expect(mockSendOutcome).not.toHaveBeenCalled();
  });

  it("swallows a load error", async () => {
    tables.refunds = [{ data: null, error: { message: "db down" } }];
    await expect(
      notifyRefundSettlement(REFUND, { newly_settled: true }),
    ).resolves.toBeUndefined();
    expect(mockSendOutcome).not.toHaveBeenCalled();
  });

  it("swallows a send failure", async () => {
    givenRefund();
    mockSendOutcome.mockRejectedValue(new Error("resend down"));
    await expect(
      notifyRefundSettlement(REFUND, { newly_settled: true }),
    ).resolves.toBeUndefined();
  });
});
