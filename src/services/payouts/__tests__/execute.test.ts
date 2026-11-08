import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockFrom,
  mockRpc,
  tables,
  updates,
  isCalls,
  mockAccounts,
  mockCreate,
  mockGetLimit,
  mockIncrease,
  mockSettle,
} = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
  const updates: Array<Record<string, unknown>> = [];
  const isCalls: Array<[string, unknown]> = [];

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "maybeSingle"]) {
      b[m] = vi.fn(() => b);
    }
    b.is = vi.fn((col: string, val: unknown) => {
      isCalls.push([col, val]);
      return b;
    });
    b.update = vi.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return b;
    });
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
    updates,
    isCalls,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockRpc: vi.fn(),
    mockAccounts: vi.fn(),
    mockCreate: vi.fn(),
    mockGetLimit: vi.fn(),
    mockIncrease: vi.fn(),
    mockSettle: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

vi.mock("@/services/chip/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/chip/send")>();
  return {
    ...actual,
    getChipSendAccounts: mockAccounts,
    createChipSendInstruction: mockCreate,
    getChipSendLimit: mockGetLimit,
    increaseChipSendLimit: mockIncrease,
  };
});

vi.mock("../settle", () => ({ settlePayout: mockSettle }));

import { ChipSendError } from "@/services/chip/send";
import { executePayout } from "../execute";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ID = "11111111-1111-4111-8111-111111111111";

function payout(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    tournament_id: "t-1",
    amount_cents: 10000,
    approval: "approved",
    status: "pending",
    processed_at: null,
    chip_send_limit_id: null,
    tournament: { name: "KL Open" },
    recipient: { email: "org@x.test" },
    bank: { is_active: true, status: "verified", chip_bank_account_id: 42 },
    ...overrides,
  };
}

function givenPayout(overrides: Record<string, unknown> = {}) {
  tables.payouts = [{ data: payout(overrides), error: null }];
}

function givenRpc({
  blocked = null,
  available = 10000,
}: { blocked?: string | null; available?: number } = {}) {
  mockRpc.mockImplementation((name: string) =>
    Promise.resolve(
      name === "tournament_payout_block_reason"
        ? { data: blocked, error: null }
        : { data: available, error: null },
    ),
  );
}

function instruction(overrides: Record<string, unknown> = {}) {
  return {
    id: 8,
    amount: "100.00",
    state: "received",
    receipt_url: "https://chip.test/r/8",
    ...overrides,
  };
}

const balance = (ringgit: number) => ({
  results: [{ currency: "MYR", current_balance: ringgit }],
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  updates.length = 0;
  isCalls.length = 0;
  givenRpc();
  mockAccounts.mockResolvedValue(balance(1000));
  mockCreate.mockResolvedValue(instruction());
  mockSettle.mockResolvedValue({ error: null, settled: true });
  mockIncrease.mockResolvedValue({ id: 77 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe("nothing to do", () => {
  it.each([
    ["already settled", { processed_at: "2026-11-01T00:00:00Z" }],
    ["not approved", { approval: "pending" }],
    ["already in flight", { status: "processing" }],
  ])("skips a payout that is %s", async (_label, overrides) => {
    givenPayout(overrides);
    expect(await executePayout(ID)).toBe("skipped");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("skips a missing payout", async () => {
    tables.payouts = [{ data: null, error: null }];
    expect(await executePayout(ID)).toBe("skipped");
  });

  it("reports a failed load as an error, not a skip", async () => {
    tables.payouts = [{ data: null, error: { message: "db down" } }];
    expect(await executePayout(ID)).toBe("error");
  });

  it("never throws, even when CHIP blows up unexpectedly", async () => {
    givenPayout();
    mockAccounts.mockRejectedValue(new Error("socket hang up"));
    await expect(executePayout(ID)).resolves.toBe("error");
    expect(mockSettle).not.toHaveBeenCalled();
  });
});

describe("blocks", () => {
  it("fails a cancelled tournament's payout for good", async () => {
    givenPayout();
    givenRpc({ blocked: "tournament_cancelled" });
    expect(await executePayout(ID)).toBe("failed");
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ paid: false, failureReason: "tournament_cancelled" }),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each(["cancellation_pending", "refund_pending"])(
    "holds, without failing, on %s",
    async (blocked) => {
      givenPayout();
      givenRpc({ blocked });
      expect(await executePayout(ID)).toBe("blocked");
      expect(mockSettle).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["superseded", { is_active: false, status: "verified", chip_bank_account_id: 42 }],
    ["unverified", { is_active: true, status: "pending", chip_bank_account_id: 42 }],
    ["unregistered", { is_active: true, status: "verified", chip_bank_account_id: null }],
    ["missing", null],
  ])("refuses to pay a %s bank account", async (_label, bank) => {
    givenPayout({ bank });
    expect(await executePayout(ID)).toBe("failed");
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ failureReason: "bank_account_not_verified" }),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------------

describe("amount", () => {
  it("asks for the balance excluding this payout's own reservation", async () => {
    givenPayout();
    await executePayout(ID);
    expect(mockRpc).toHaveBeenCalledWith("available_payout_cents", {
      p_tournament_id: "t-1",
      p_exclude_payout_id: ID,
    });
  });

  it("clamps to what is available now, and records it before sending", async () => {
    givenPayout();
    givenRpc({ available: 6000 });
    await executePayout(ID);
    expect(updates[0]).toEqual({ amount_cents: 6000 });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 6000 }),
    );
  });

  it("does not raise the amount when more has become available", async () => {
    givenPayout({ amount_cents: 4000 });
    givenRpc({ available: 10000 });
    await executePayout(ID);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 4000 }),
    );
  });

  it("fails below the minimum, without calling CHIP", async () => {
    givenPayout();
    givenRpc({ available: 999 });
    expect(await executePayout(ID)).toBe("failed");
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        paid: false,
        failureReason: "insufficient_available_balance",
      }),
    );
    expect(mockAccounts).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

describe("awaiting budget", () => {
  it("requests budget and leaves the row pending when the balance is short", async () => {
    givenPayout();
    mockAccounts.mockResolvedValue(balance(99.99));
    expect(await executePayout(ID)).toBe("awaiting_budget");
    expect(mockIncrease).toHaveBeenCalledWith(10000);
    expect(updates).toContainEqual({ chip_send_limit_id: 77 });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("sends when the balance exactly covers it", async () => {
    givenPayout();
    mockAccounts.mockResolvedValue(balance(100));
    expect(await executePayout(ID)).toBe("sent");
  });

  it("does not email approvers again while an allocation is still pending", async () => {
    givenPayout({ chip_send_limit_id: 77 });
    mockAccounts.mockResolvedValue(balance(1));
    mockGetLimit.mockResolvedValue({ id: 77, status: "pending" });
    expect(await executePayout(ID)).toBe("awaiting_budget");
    expect(mockGetLimit).toHaveBeenCalledWith(77);
    expect(mockIncrease).not.toHaveBeenCalled();
  });

  it("replaces an expired allocation, so the payout can't stall forever", async () => {
    givenPayout({ chip_send_limit_id: 77 });
    mockAccounts.mockResolvedValue(balance(1));
    mockGetLimit.mockResolvedValue({ id: 77, status: "expired" });
    mockIncrease.mockResolvedValue({ id: 78 });
    expect(await executePayout(ID)).toBe("awaiting_budget");
    expect(updates).toContainEqual({ chip_send_limit_id: 78 });
  });

  it("assumes a live allocation when it can't read it", async () => {
    givenPayout({ chip_send_limit_id: 77 });
    mockAccounts.mockResolvedValue(balance(1));
    mockGetLimit.mockRejectedValue(new ChipSendError(500, "down"));
    expect(await executePayout(ID)).toBe("awaiting_budget");
    expect(mockIncrease).not.toHaveBeenCalled();
  });

  it("does not burn the row when the budget request itself fails", async () => {
    givenPayout();
    mockAccounts.mockResolvedValue(balance(1));
    mockIncrease.mockRejectedValue(new ChipSendError(400, "no convertible balance"));
    expect(await executePayout(ID)).toBe("awaiting_budget");
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it.each([
    ["the documented 403", new ChipSendError(403, "forbidden", true)],
    [
      "the sandbox's 400",
      new ChipSendError(
        400,
        '{"message":"Balance not enough. Please increase your Send Limit","code":400,"data":{}}',
        true,
      ),
    ],
  ])("parks the payout on %s from create-send-instruction", async (_label, err) => {
    givenPayout();
    mockCreate.mockRejectedValue(err);
    expect(await executePayout(ID)).toBe("awaiting_budget");
    expect(mockIncrease).toHaveBeenCalledWith(10000);
    expect(mockSettle).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

describe("sending", () => {
  it("sends with the row id as the idempotent reference", async () => {
    givenPayout();
    await executePayout(ID);
    expect(mockCreate).toHaveBeenCalledWith({
      bank_account_id: 42,
      amountCents: 10000,
      description: "MY Chess Tour payout - KL Open",
      email: "org@x.test",
      reference: ID,
      send_recipient_receipt: true,
    });
  });

  it("keeps the description within CHIP's 140 characters", async () => {
    givenPayout({ tournament: { name: "x".repeat(300) } });
    await executePayout(ID);
    expect(mockCreate.mock.calls[0][0].description).toHaveLength(140);
  });

  it("sends only characters CHIP accepts, whatever the tournament is called", async () => {
    givenPayout({ tournament: { name: "Penang's Rapid & Blitz: Kejohanan #3 – Café" } });
    await executePayout(ID);
    const description = mockCreate.mock.calls[0][0].description as string;
    expect(description).toMatch(/^[A-Za-z0-9 ._\-/@()]+$/);
    expect(description).toBe("MY Chess Tour payout - Penangs Rapid Blitz Kejohanan 3 Cafe");
  });

  it("marks it processing and waits for the webhook", async () => {
    givenPayout();
    expect(await executePayout(ID)).toBe("sent");
    expect(updates).toContainEqual({
      chip_send_instruction_id: 8,
      status: "processing",
    });
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("never lets `processing` overwrite a row the webhook already settled", async () => {
    givenPayout();
    await executePayout(ID);
    expect(isCalls).toContainEqual(["processed_at", null]);
  });

  it("settles a synchronous completion straight away, at CHIP's amount", async () => {
    givenPayout();
    mockCreate.mockResolvedValue(
      instruction({ state: "completed", amount: "99.50" }),
    );
    expect(await executePayout(ID)).toBe("paid");
    expect(mockSettle).toHaveBeenCalledWith({
      payoutId: ID,
      chipSendInstructionId: 8,
      paid: true,
      amountCents: 9950,
      receiptUrl: "https://chip.test/r/8",
    });
  });

  it("settles a synchronous rejection as failed", async () => {
    givenPayout();
    mockCreate.mockResolvedValue(instruction({ state: "rejected" }));
    expect(await executePayout(ID)).toBe("failed");
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        paid: false,
        chipSendInstructionId: 8,
        failureReason: "send_instruction_rejected",
      }),
    );
  });

  it("does not call a completed transfer failed if booking it hiccups", async () => {
    givenPayout();
    mockCreate.mockResolvedValue(instruction({ state: "completed" }));
    mockSettle.mockResolvedValue({
      error: { message: "db down" },
      settled: false,
    });
    expect(await executePayout(ID)).toBe("sent");
  });

  it("treats a rejected request as terminal, with digits redacted", async () => {
    givenPayout();
    mockCreate.mockRejectedValue(
      new ChipSendError(400, '{"message":"Bad account 514000001234"}'),
    );
    expect(await executePayout(ID)).toBe("failed");
    const reason = mockSettle.mock.calls[0][0].failureReason as string;
    expect(reason).toContain("chip_send_400");
    expect(reason).not.toContain("514000001234");
  });

  it.each([
    ["401 (our credentials or clock)", 401],
    ["408", 408],
    ["429 (rate limit)", 429],
    ["500", 500],
    ["503", 503],
  ])("leaves the payout pending on %s", async (_label, status) => {
    givenPayout();
    mockCreate.mockRejectedValue(new ChipSendError(status, "try later"));
    expect(await executePayout(ID)).toBe("error");
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("leaves the payout pending on a network failure", async () => {
    givenPayout();
    mockCreate.mockRejectedValue(new TypeError("fetch failed"));
    expect(await executePayout(ID)).toBe("error");
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("leaves the payout pending when the recipient has no email", async () => {
    givenPayout({ recipient: { email: null } });
    expect(await executePayout(ID)).toBe("error");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Logging: every way a payout fails or stalls leaves a line saying why
// ---------------------------------------------------------------------------

function logged(level: "error" | "warn" | "info"): string {
  return vi
    .mocked(console[level])
    .mock.calls.map((args) => args.map(String).join(" "))
    .join("\n");
}

describe("logging", () => {
  it("logs a terminal failure with its reason, digits redacted", async () => {
    givenPayout();
    mockCreate.mockRejectedValue(
      new ChipSendError(400, '{"message":"Bad account 514000001234"}'),
    );
    await executePayout(ID);
    expect(logged("error")).toContain(`Payout ${ID}: failed (chip_send_400`);
    expect(logged("error")).not.toContain("514000001234");
  });

  it("logs why the bank account can't be paid", async () => {
    givenPayout({
      bank: { is_active: false, status: "verified", chip_bank_account_id: 42 },
    });
    await executePayout(ID);
    expect(logged("error")).toContain("failed (bank_account_not_verified)");
    expect(logged("error")).toContain("active=false");
  });

  it("logs the figures when too little is left to pay", async () => {
    givenPayout();
    givenRpc({ available: 500 });
    await executePayout(ID);
    expect(logged("error")).toContain("failed (insufficient_available_balance)");
    expect(logged("error")).toContain("500 available");
  });

  it("logs a payout parked on budget, with the balance and the request", async () => {
    givenPayout();
    mockAccounts.mockResolvedValue(balance(50));
    await executePayout(ID);
    expect(logged("warn")).toContain("balance 5000 cents is below the 10000 cents payout");
    expect(logged("warn")).toContain("requested send limit 77");
  });

  it("logs a payout still waiting on an earlier budget request", async () => {
    givenPayout({ chip_send_limit_id: 5 });
    mockAccounts.mockResolvedValue(balance(50));
    mockGetLimit.mockResolvedValue({ id: 5, status: "pending" });
    await executePayout(ID);
    expect(logged("warn")).toContain("send limit 5 is still waiting for approval");
  });

  it("names a failed balance read instead of a generic error", async () => {
    givenPayout();
    mockAccounts.mockRejectedValue(new ChipSendError(503, "maintenance"));
    await executePayout(ID);
    expect(logged("error")).toContain("could not read the CHIP Send balance");
    expect(logged("error")).toContain("CHIP Send 503");
  });

  it("includes the SQLSTATE of a database error", async () => {
    tables.payouts = [{ data: null, error: { code: "57014", message: "timeout" } }];
    await executePayout(ID);
    expect(logged("error")).toContain("57014: timeout");
  });

  it("logs a skipped payout's state", async () => {
    givenPayout({ status: "processing" });
    await executePayout(ID);
    expect(logged("info")).toContain("skipped (status processing");
  });
});
