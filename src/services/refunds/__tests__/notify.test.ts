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
          user_id: "farid-id",
          participant: { first_name: "Farid", last_name: "Hamzah" },
          tournament: { name: "KL Open" },
          payment: {
            payment_method: "razer_grabpay",
            user_id: "farid-id",
            payer: { email: "farid@example.com", first_name: "Farid" },
          },
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
      recipientName: "Farid",
      aboutPlayer: null,
      tournamentName: "KL Open",
      amountCents: 11000,
      paymentMethod: "GrabPay",
      completed: true,
    });
  });

  it("emails a guardian who paid, naming the dependent (#716)", async () => {
    givenRefund({
      registration: {
        user_id: "aina-id",
        participant: { first_name: "Aina", last_name: "Rahman" },
        tournament: { name: "KL Open" },
        payment: {
          payment_method: "fpx_b2c",
          user_id: "siti-id",
          payer: { email: "mum@example.com", first_name: "Siti" },
        },
      },
    });
    await notifyRefundSettlement(REFUND, { newly_settled: true });

    expect(mockSendOutcome).toHaveBeenCalledTimes(1);
    expect(mockSendOutcome).toHaveBeenCalledWith(
      "mum@example.com",
      expect.objectContaining({ recipientName: "Siti", aboutPlayer: "Aina Rahman" }),
    );
  });

  it("reads the address from the refunded payment's payer, not the registration", async () => {
    givenRefund();
    await notifyRefundSettlement(REFUND, { newly_settled: true });

    const builder = mockFrom.mock.results[0].value as { select: ReturnType<typeof vi.fn> };
    const columns = (builder.select.mock.calls[0][0] as string).replace(/\s+/g, " ");
    expect(columns).toContain(
      "payment:payments!current_payment_id( payment_method, user_id, payer:users!user_id(email, first_name) )",
    );
    expect(columns).not.toMatch(/registrations!registration_id\( user:/);
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
        user_id: "farid-id",
        participant: null,
        tournament: null,
        payment: {
          payment_method: null,
          user_id: "farid-id",
          payer: { email: "farid@example.com", first_name: null },
        },
      },
    });
    await notifyRefundSettlement(REFUND, { newly_settled: true });

    expect(mockSendOutcome).toHaveBeenCalledWith("farid@example.com", {
      recipientName: "Player",
      aboutPlayer: null,
      tournamentName: "your tournament",
      amountCents: 11000,
      paymentMethod: "your original payment method",
      completed: true,
    });
  });

  it("sends nothing when the payer has no address", async () => {
    givenRefund({
      registration: {
        tournament: { name: "KL Open" },
        payment: { payment_method: "fpx_b2c", payer: null },
      },
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
