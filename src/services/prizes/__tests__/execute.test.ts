import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  tables,
  updates,
  mockFrom,
  mockRpc,
  mockAccounts,
  mockCreateInstruction,
  mockIncreaseLimit,
  mockGetLimit,
  mockRegister,
  mockSettle,
  mockNotifyAwarded,
  mockNotifyAdmins,
  mockLoadPayees,
  mockMinorIds,
} = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
  const updates: Array<{ table: string; patch: unknown }> = [];

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order", "maybeSingle", "single"]) {
      b[m] = vi.fn(() => b);
    }
    b.update = vi.fn((patch: unknown) => {
      updates.push({ table, patch });
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
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockRpc: vi.fn(),
    mockAccounts: vi.fn(),
    mockCreateInstruction: vi.fn(),
    mockIncreaseLimit: vi.fn(),
    mockGetLimit: vi.fn(),
    mockRegister: vi.fn(),
    mockSettle: vi.fn(),
    mockNotifyAwarded: vi.fn(),
    mockNotifyAdmins: vi.fn(),
    mockLoadPayees: vi.fn(),
    mockMinorIds: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));
vi.mock("@/services/chip/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/chip/send")>()),
  getChipSendAccounts: mockAccounts,
  createChipSendInstruction: mockCreateInstruction,
  increaseChipSendLimit: mockIncreaseLimit,
  getChipSendLimit: mockGetLimit,
}));
vi.mock("@/services/payouts/bank-account", () => ({
  registerPlayerBankAccount: mockRegister,
}));
vi.mock("../settle", () => ({ settlePrizeAward: mockSettle }));
vi.mock("../notify", () => ({
  notifyPrizeAwarded: mockNotifyAwarded,
  notifyAdminsOfPrizes: mockNotifyAdmins,
}));
vi.mock("../payee", () => ({
  loadPrizePayees: mockLoadPayees,
  minorDependentIds: mockMinorIds,
}));

function payeesOf(entries: Array<[string, string, "winner" | "guardian_of_minor"]>) {
  return {
    ok: true,
    payees: new Map(
      entries.map(([winnerId, payeeId, reason]) => [winnerId, { winnerId, payeeId, reason }]),
    ),
  };
}

import { ChipSendError } from "@/services/chip/send";
import { runAfterCallbacks } from "@/test/after";
import { executePrizeAward, onPlayerBankVerdict, sendAwardsAwaitingBank } from "../execute";

const AWARD_ID = "award-1";

function award(overrides: Record<string, unknown> = {}) {
  return {
    id: AWARD_ID,
    tournament_id: "t-1",
    user_id: "user-1",
    category: "Open",
    amount_cents: 30000,
    approval: "approved",
    status: "pending",
    processed_at: null,
    chip_send_instruction_id: null,
    chip_send_limit_id: null,
    tournament: { name: "Merdeka Open" },
    winner: { email: "winner@test.local" },
    bank: null,
    ...overrides,
  };
}

const verifiedBank = { id: "bank-1", status: "verified", chip_bank_account_id: 930101 };

function queueHappyPath(bankRow: unknown = verifiedBank) {
  tables.prize_awards = [
    { data: award(), error: null },
    { data: award({ status: "processing", bank: { chip_bank_account_id: 930101 } }), error: null },
  ];
  tables.player_bank_accounts = [{ data: bankRow, error: null }];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  updates.length = 0;
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockAccounts.mockResolvedValue({ results: [{ currency: "MYR", current_balance: 1000 }] });
  mockCreateInstruction.mockResolvedValue({ id: 7001, state: "accepted", amount: "300.00", receipt_url: null });
  mockSettle.mockResolvedValue({ error: null, settled: true });
  mockRegister.mockResolvedValue("pending");
  mockLoadPayees.mockImplementation(async (ids: string[]) =>
    payeesOf(ids.map((id) => [id, id, "winner"])),
  );
  mockMinorIds.mockResolvedValue({ ok: true, ids: [] });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("executePrizeAward", () => {
  it("claims and sends an approved award to the winner's verified account", async () => {
    queueHappyPath();

    expect(await executePrizeAward(AWARD_ID)).toBe("sent");
    expect(mockRpc).toHaveBeenCalledWith("claim_prize_award_send", { p_award_id: AWARD_ID });
    expect(mockCreateInstruction).toHaveBeenCalledWith(
      expect.objectContaining({
        bank_account_id: 930101,
        amountCents: 30000,
        email: "winner@test.local",
        reference: AWARD_ID,
        description: "MY Chess Tour prize - Merdeka Open",
      }),
    );
    expect(updates).toContainEqual({
      table: "prize_awards",
      patch: { chip_send_instruction_id: 7001, status: "processing" },
    });
  });

  it("settles at once when CHIP completes the transfer synchronously", async () => {
    queueHappyPath();
    mockCreateInstruction.mockResolvedValue({
      id: 7001, state: "completed", amount: "300.00", receipt_url: "https://r.test/1",
    });

    expect(await executePrizeAward(AWARD_ID)).toBe("paid");
    expect(mockSettle).toHaveBeenCalledWith({
      awardId: AWARD_ID,
      chipSendInstructionId: 7001,
      paid: true,
      amountCents: 30000,
      receiptUrl: "https://r.test/1",
    });
  });

  it.each([
    ["unapproved", { approval: "pending" }],
    ["rejected", { approval: "rejected" }],
    ["settled", { processed_at: "2026-11-01T00:00:00Z", status: "paid" }],
    ["out with CHIP", { status: "processing", chip_send_instruction_id: 7001 }],
  ])("skips an award that is %s", async (_label, overrides) => {
    tables.prize_awards = [{ data: award(overrides), error: null }];
    expect(await executePrizeAward(AWARD_ID)).toBe("skipped");
    expect(mockCreateInstruction).not.toHaveBeenCalled();
  });

  it("waits, money reserved, while the winner has no bank account", async () => {
    tables.prize_awards = [{ data: award(), error: null }];
    tables.player_bank_accounts = [{ data: null, error: null }];

    expect(await executePrizeAward(AWARD_ID)).toBe("blocked");
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockCreateInstruction).not.toHaveBeenCalled();
  });

  it("waits while the winner's account is rejected, without asking CHIP again", async () => {
    tables.prize_awards = [{ data: award(), error: null }];
    tables.player_bank_accounts = [{ data: { ...verifiedBank, status: "rejected" }, error: null }];

    expect(await executePrizeAward(AWARD_ID)).toBe("blocked");
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("registers a pending account with CHIP the first time a prize needs it", async () => {
    tables.prize_awards = [{ data: award(), error: null }];
    tables.player_bank_accounts = [
      { data: { id: "bank-1", status: "pending", chip_bank_account_id: null }, error: null },
    ];

    expect(await executePrizeAward(AWARD_ID)).toBe("blocked");
    expect(mockRegister).toHaveBeenCalledWith("bank-1");
    expect(mockCreateInstruction).not.toHaveBeenCalled();
  });

  it("pays straight away when CHIP verifies the account on the spot", async () => {
    queueHappyPath({ id: "bank-1", status: "pending", chip_bank_account_id: null });
    mockRegister.mockResolvedValue("verified");

    expect(await executePrizeAward(AWARD_ID)).toBe("sent");
    expect(mockRegister).toHaveBeenCalledWith("bank-1");
  });

  it("parks the award on budget and alerts admins once", async () => {
    queueHappyPath();
    mockAccounts.mockResolvedValue({ results: [{ currency: "MYR", current_balance: 300 }] });
    mockIncreaseLimit.mockResolvedValue({ id: 55, status: "pending" });

    expect(await executePrizeAward(AWARD_ID)).toBe("awaiting_budget");
    expect(mockIncreaseLimit).toHaveBeenCalledWith(30100);
    expect(updates).toContainEqual({ table: "prize_awards", patch: { chip_send_limit_id: 55 } });
    expect(mockRpc).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(mockNotifyAdmins).toHaveBeenCalledWith("t-1", "awaiting_budget", 30000, expect.any(String));
  });

  it("doesn't request budget again while an earlier request still waits", async () => {
    tables.prize_awards = [{ data: award({ chip_send_limit_id: 55 }), error: null }];
    tables.player_bank_accounts = [{ data: verifiedBank, error: null }];
    mockAccounts.mockResolvedValue({ results: [{ currency: "MYR", current_balance: 0 }] });
    mockGetLimit.mockResolvedValue({ id: 55, status: "pending" });

    expect(await executePrizeAward(AWARD_ID)).toBe("awaiting_budget");
    expect(mockIncreaseLimit).not.toHaveBeenCalled();
  });

  it("fails an award on a cancelled tournament at the claim", async () => {
    tables.prize_awards = [{ data: award(), error: null }];
    tables.player_bank_accounts = [{ data: verifiedBank, error: null }];
    mockRpc.mockResolvedValue({ data: "tournament_cancelled", error: null });

    expect(await executePrizeAward(AWARD_ID)).toBe("failed");
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ awardId: AWARD_ID, paid: false, failureReason: "tournament_cancelled" }),
    );
    expect(mockCreateInstruction).not.toHaveBeenCalled();
  });

  it("holds an award the claim refuses for a pending cancellation", async () => {
    tables.prize_awards = [{ data: award(), error: null }];
    tables.player_bank_accounts = [{ data: verifiedBank, error: null }];
    mockRpc.mockResolvedValue({ data: "cancellation_pending", error: null });

    expect(await executePrizeAward(AWARD_ID)).toBe("blocked");
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("fails on a terminal CHIP refusal, with the account number redacted", async () => {
    queueHappyPath();
    mockCreateInstruction.mockRejectedValue(
      new ChipSendError(422, "Bank account 514100000101 is closed"),
    );

    expect(await executePrizeAward(AWARD_ID)).toBe("failed");
    const reason = mockSettle.mock.calls[0][0].failureReason as string;
    expect(reason).toMatch(/^chip_send_422/);
    expect(reason).not.toContain("514100000101");
  });

  it("releases the claim when CHIP turned the send away before reading it", async () => {
    queueHappyPath();
    mockCreateInstruction.mockRejectedValue(new ChipSendError(401, "bad signature"));

    expect(await executePrizeAward(AWARD_ID)).toBe("error");
    expect(updates).toContainEqual({ table: "prize_awards", patch: { status: "pending" } });
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("keeps the claim when the send may have landed", async () => {
    queueHappyPath();
    mockCreateInstruction.mockRejectedValue(new ChipSendError(503, "unavailable"));

    expect(await executePrizeAward(AWARD_ID)).toBe("error");
    expect(updates).not.toContainEqual({ table: "prize_awards", patch: { status: "pending" } });
  });

  it("resumes a claimed award by sending the same reference, unchecked", async () => {
    tables.prize_awards = [
      { data: award({ status: "processing", bank: { chip_bank_account_id: 930101 } }), error: null },
    ];

    expect(await executePrizeAward(AWARD_ID)).toBe("sent");
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAccounts).not.toHaveBeenCalled();
    expect(mockCreateInstruction).toHaveBeenCalledWith(
      expect.objectContaining({ reference: AWARD_ID, bank_account_id: 930101 }),
    );
  });

  it("never throws", async () => {
    tables.prize_awards = [{ data: null, error: { message: "db down" } }];
    expect(await executePrizeAward(AWARD_ID)).toBe("error");
  });
});

describe("executePrizeAward for a minor (#718)", () => {
  it("registers and pays the guardian's account, emailing CHIP the guardian's address", async () => {
    mockLoadPayees.mockResolvedValue(payeesOf([["child-1", "guardian-1", "guardian_of_minor"]]));
    tables.prize_awards = [
      { data: award({ user_id: "child-1", winner: { email: null, contact_email: null } }), error: null },
      { data: award({ status: "processing", bank: { chip_bank_account_id: 930101 } }), error: null },
    ];
    tables.users = [{ data: { email: "guardian@test.local", contact_email: null }, error: null }];
    tables.player_bank_accounts = [{ data: verifiedBank, error: null }];

    expect(await executePrizeAward(AWARD_ID)).toBe("sent");
    const bankQuery = mockFrom.mock.results[mockFrom.mock.calls.findIndex(([t]) => t === "player_bank_accounts")]
      .value as { eq: ReturnType<typeof vi.fn> };
    expect(bankQuery.eq).toHaveBeenCalledWith("user_id", "guardian-1");
    expect(mockCreateInstruction).toHaveBeenCalledWith(
      expect.objectContaining({ email: "guardian@test.local" }),
    );
  });

  it("waits when the guardian has no bank account", async () => {
    mockLoadPayees.mockResolvedValue(payeesOf([["child-1", "guardian-1", "guardian_of_minor"]]));
    tables.prize_awards = [{ data: award({ user_id: "child-1" }), error: null }];
    tables.users = [{ data: { email: "guardian@test.local", contact_email: null }, error: null }];
    tables.player_bank_accounts = [{ data: null, error: null }];

    expect(await executePrizeAward(AWARD_ID)).toBe("blocked");
    expect(mockRpc).not.toHaveBeenCalledWith("claim_prize_award_send", expect.anything());
  });

  it("falls back to support for CHIP's email when a managed winner has none", async () => {
    queueHappyPath();
    tables.prize_awards[0] = {
      data: award({ winner: { email: null, contact_email: null } }),
      error: null,
    };

    expect(await executePrizeAward(AWARD_ID)).toBe("sent");
    expect(mockCreateInstruction).toHaveBeenCalledWith(
      expect.objectContaining({ email: expect.stringContaining("@") }),
    );
    expect(mockCreateInstruction.mock.calls[0][0].email).not.toBe("winner@test.local");
  });
});

describe("sendAwardsAwaitingBank", () => {
  it("sends each approved award waiting on the winner", async () => {
    tables.prize_awards = [
      { data: [{ id: "a1", user_id: "user-1" }, { id: "a2", user_id: "user-1" }], error: null },
      { data: award({ id: "a1", approval: "pending" }), error: null },
      { data: award({ id: "a2", approval: "pending" }), error: null },
    ];
    await sendAwardsAwaitingBank("user-1");
    expect(mockFrom).toHaveBeenCalledTimes(3);
  });

  it("costs one query when nothing is waiting", async () => {
    tables.prize_awards = [{ data: [], error: null }];
    await sendAwardsAwaitingBank("user-1");
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("includes the awards of a guardian's minor dependents paid into the guardian's account (#718)", async () => {
    mockMinorIds.mockResolvedValue({ ok: true, ids: ["child-1", "child-2"] });
    mockLoadPayees.mockResolvedValue(
      payeesOf([
        ["child-1", "user-1", "guardian_of_minor"],
        ["child-2", "other-guardian", "guardian_of_minor"],
      ]),
    );
    tables.prize_awards = [
      {
        data: [
          { id: "a-child", user_id: "child-1" },
          { id: "a-sibling", user_id: "child-2" },
        ],
        error: null,
      },
    ];

    await onPlayerBankVerdict("user-1", false);

    expect(mockNotifyAwarded).toHaveBeenCalledWith("a-child", { accountRejected: true });
    expect(mockNotifyAwarded).not.toHaveBeenCalledWith("a-sibling", expect.anything());
  });
});

describe("onPlayerBankVerdict", () => {
  it("tells the winner of each waiting award that their account was rejected", async () => {
    tables.prize_awards = [
      { data: [{ id: "a1", user_id: "user-1" }, { id: "a2", user_id: "user-1" }], error: null },
    ];
    await onPlayerBankVerdict("user-1", false);
    expect(mockNotifyAwarded).toHaveBeenCalledWith("a1", { accountRejected: true });
    expect(mockNotifyAwarded).toHaveBeenCalledWith("a2", { accountRejected: true });
  });

  it("sends waiting awards once the account is verified", async () => {
    tables.prize_awards = [{ data: [], error: null }];
    await onPlayerBankVerdict("user-1", true);
    expect(mockNotifyAwarded).not.toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith("prize_awards");
  });
});
