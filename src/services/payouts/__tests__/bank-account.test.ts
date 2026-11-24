import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAfterCallbacks } from "@/test/after";

const { mockFrom, mockRpc, tables, updates, mockRegister, mockSendEmail } =
  vi.hoisted(() => {
    const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
    const updates: Array<{ table: string; values: unknown }> = [];

    function makeBuilder(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "lt", "order", "maybeSingle", "single"]) {
        b[m] = vi.fn(() => b);
      }
      b.update = vi.fn((values: unknown) => {
        updates.push({ table, values });
        return b;
      });
      b.then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) =>
        Promise.resolve(
          tables[table]?.shift() ?? { data: null, error: null },
        ).then(onfulfilled, onrejected);
      return b;
    }

    return {
      tables,
      updates,
      mockFrom: vi.fn((table: string) => makeBuilder(table)),
      mockRpc: vi.fn(),
      mockRegister: vi.fn(),
      mockSendEmail: vi.fn(),
    };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

vi.mock("@/services/chip/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/chip/send")>();
  return { ...actual, registerChipBankAccount: mockRegister };
});

vi.mock("@/services/email/email", () => ({
  sendBankVerificationEmail: mockSendEmail,
}));

import { ChipSendError } from "@/services/chip/send";
import {
  notifyBankVerification,
  registerActiveOrganizationBankAccount,
  registerOrganizationBankAccount,
  registerPendingBankAccounts,
  reviewBankAccountName,
  settleBankAccountVerification,
} from "../bank-account";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const BANK_ID = "22222222-2222-4222-8222-222222222222";

const pendingRow = {
  id: BANK_ID,
  organization_id: ORG_ID,
  bank_code: "MBBEMYKL",
  bank_name: "Maybank",
  account_holder: "KL Chess Club",
  account_number: "157380112229",
  status: "pending",
  is_active: true,
  chip_bank_account_id: null,
};

function queue(table: string, ...results: Array<{ data: unknown; error: unknown }>) {
  tables[table] = [...(tables[table] ?? []), ...results];
}

function queueExpectedName(registeredName: string | null = null) {
  queue("organization_bank_accounts", {
    data: { account_holder: "KL Chess Club", organization_id: ORG_ID },
    error: null,
  });
  queue("organization_registered_names", {
    data: registeredName ? { registered_name: registeredName } : null,
    error: null,
  });
}

function queueNotifyData(
  status: "verified" | "rejected" | "name_mismatch",
  reason: string | null = null,
) {
  queue("organization_memberships", {
    data: [
      { user: { email: "Owner@x.com", first_name: "Olivia" }, roles: { name: "owner" } },
      { user: { email: "admin@x.com", first_name: "Adam" }, roles: { name: "admin" } },
      { user: { email: "member@x.com", first_name: "Mo" }, roles: { name: "member" } },
    ],
    error: null,
  });
  queue("organizations", {
    data: { name: "KL Chess Club", email: "owner@x.com" },
    error: null,
  });
  queue("organization_bank_accounts", {
    data: {
      bank_name: "Maybank",
      account_number: "157380112229",
      status,
      rejection_reason: reason,
    },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  updates.length = 0;
  mockSendEmail.mockResolvedValue(undefined);
  mockRpc.mockResolvedValue({
    data: {
      owner: "organization",
      organization_id: ORG_ID,
      already_processed: false,
      is_active: true,
      status: "verified",
    },
    error: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("registerOrganizationBankAccount", () => {
  it("registers with our row id as the reference and persists CHIP's id", async () => {
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    queue("organization_bank_accounts", { data: null, error: null });
    mockRegister.mockResolvedValue({ id: 84, status: "pending", rejection_reason: null });

    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBe("pending");

    expect(mockRegister).toHaveBeenCalledWith({
      account_number: "157380112229",
      bank_code: "MBBEMYKL",
      name: "KL Chess Club",
      reference: BANK_ID,
    });
    expect(updates).toEqual([
      { table: "organization_bank_accounts", values: { chip_bank_account_id: 84 } },
    ]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("settles immediately when CHIP answers verified synchronously", async () => {
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    queue("organization_bank_accounts", { data: null, error: null });
    mockRegister.mockResolvedValue({
      id: 84,
      status: "verified",
      rejection_reason: null,
      name: "KL CHESS CLUB",
    });
    queueExpectedName();
    queueNotifyData("verified");

    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBe("verified");

    expect(mockRpc).toHaveBeenCalledWith("settle_bank_account_verification", {
      p_bank_account_id: BANK_ID,
      p_chip_bank_account_id: 84,
      p_verified: true,
      p_reason: null,
      p_bank_holder_name: "KL CHESS CLUB",
      p_name_matched: true,
    });
    await runAfterCallbacks();
    expect(mockSendEmail).toHaveBeenCalled();
  });

  it("settles a synchronous rejection with CHIP's reason", async () => {
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    queue("organization_bank_accounts", { data: null, error: null });
    mockRegister.mockResolvedValue({
      id: 84,
      status: "rejected",
      rejection_reason: "Invalid account",
    });
    queueNotifyData("rejected", "Invalid account");

    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBe("rejected");

    expect(mockRpc).toHaveBeenCalledWith(
      "settle_bank_account_verification",
      expect.objectContaining({ p_verified: false, p_reason: "Invalid account" }),
    );
  });

  it("holds a verified account in someone else's name for review, without emailing", async () => {
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    queue("organization_bank_accounts", { data: null, error: null });
    mockRegister.mockResolvedValue({
      id: 84,
      status: "verified",
      rejection_reason: null,
      name: "SOMEONE ELSE",
    });
    queueExpectedName();
    mockRpc.mockResolvedValue({
      data: {
        owner: "organization",
        organization_id: ORG_ID,
        already_processed: false,
        is_active: true,
        status: "name_mismatch",
      },
      error: null,
    });

    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBe("name_mismatch");

    expect(mockRpc).toHaveBeenCalledWith(
      "settle_bank_account_verification",
      expect.objectContaining({
        p_verified: true,
        p_bank_holder_name: "SOMEONE ELSE",
        p_name_matched: false,
      }),
    );
    await runAfterCallbacks();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).toContain("admin review");
  });

  it("treats an unverified sync response as pending", async () => {
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    queue("organization_bank_accounts", { data: null, error: null });
    mockRegister.mockResolvedValue({ id: 84, status: "unverified", rejection_reason: null });

    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBe("pending");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reports an error, leaving the row pending, when the verdict can't be recorded", async () => {
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    queue("organization_bank_accounts", { data: null, error: null });
    mockRegister.mockResolvedValue({ id: 84, status: "verified", rejection_reason: null });
    mockRpc.mockResolvedValue({ data: null, error: { message: "db down" } });

    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBe("error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain(BANK_ID);
  });

  it.each([
    ["verified", { ...pendingRow, status: "verified" }],
    ["rejected", { ...pendingRow, status: "rejected" }],
    ["superseded", { ...pendingRow, is_active: false }],
    ["missing", null],
  ])("skips a %s row without calling CHIP", async (_label, row) => {
    queue("organization_bank_accounts", { data: row, error: null });
    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBe("skipped");
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("never throws when CHIP fails, and keeps account digits out of logs", async () => {
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    mockRegister.mockRejectedValue(
      new ChipSendError(400, '{"account_number":"157380112229 is invalid"}'),
    );

    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBe("error");

    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain(BANK_ID);
    expect(logged).toContain("400");
    expect(logged).not.toContain("157380112229");
    expect(updates).toHaveLength(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("never throws when the row load fails", async () => {
    queue("organization_bank_accounts", { data: null, error: { message: "db down" } });
    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBe("error");
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("never throws on an unexpected error", async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error("kaboom");
    });
    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBe("error");
  });
});

describe("registerActiveOrganizationBankAccount", () => {
  it("registers the organization's active row", async () => {
    queue("organization_bank_accounts", { data: { id: BANK_ID }, error: null });
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    queue("organization_bank_accounts", { data: null, error: null });
    mockRegister.mockResolvedValue({ id: 84, status: "pending", rejection_reason: null });

    await registerActiveOrganizationBankAccount(ORG_ID);
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ reference: BANK_ID }),
    );
  });

  it("does nothing when there is no active row", async () => {
    queue("organization_bank_accounts", { data: null, error: null });
    await registerActiveOrganizationBankAccount(ORG_ID);
    expect(mockRegister).not.toHaveBeenCalled();
  });
});

describe("registerPendingBankAccounts", () => {
  const NOW = new Date("2026-11-17T01:00:00Z");

  it("loads every active, pending account of an approved organization past the grace period", async () => {
    queue("organization_bank_accounts", { data: [], error: null });

    await registerPendingBankAccounts(NOW);

    const builder = mockFrom.mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>;
    expect(mockFrom).toHaveBeenCalledWith("organization_bank_accounts");
    expect(builder.select).toHaveBeenCalledWith("id, organizations!inner(approval_status)");
    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
    expect(builder.eq).toHaveBeenCalledWith("status", "pending");
    expect(builder.is).not.toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("organizations.approval_status", "approved");
    expect(builder.lt).toHaveBeenCalledWith("created_at", "2026-11-17T00:45:00.000Z");
  });

  it("registers each row and counts what each came to", async () => {
    const OTHER_ID = "33333333-3333-4333-8333-333333333333";
    queue(
      "organization_bank_accounts",
      { data: [{ id: BANK_ID }, { id: OTHER_ID }], error: null },
      { data: pendingRow, error: null },
      { data: null, error: { message: "db down" } },
      { data: null, error: null },
    );
    mockRegister.mockResolvedValue({ id: 84, status: "pending", rejection_reason: null });

    const stats = await registerPendingBankAccounts(NOW);

    expect(stats).toEqual({
      checked: 2,
      verified: 0,
      rejected: 0,
      name_mismatch: 0,
      pending: 1,
      skipped: 0,
      error: 1,
    });
    expect(mockRegister).toHaveBeenCalledOnce();
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ reference: BANK_ID }),
    );
  });

  it("settles an account CHIP already has from its current verdict", async () => {
    queue(
      "organization_bank_accounts",
      { data: [{ id: BANK_ID }], error: null },
      { data: { ...pendingRow, chip_bank_account_id: 84 }, error: null },
      { data: null, error: null },
    );
    mockRegister.mockResolvedValue({
      id: 84,
      status: "verified",
      rejection_reason: null,
      name: "KL CHESS CLUB",
    });
    queueExpectedName();
    queueNotifyData("verified");

    const stats = await registerPendingBankAccounts(NOW);

    expect(stats.verified).toBe(1);
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ reference: BANK_ID }),
    );
    expect(mockRpc).toHaveBeenCalledWith(
      "settle_bank_account_verification",
      expect.objectContaining({ p_bank_account_id: BANK_ID, p_verified: true }),
    );
  });

  it("returns zero counts when nothing is waiting", async () => {
    queue("organization_bank_accounts", { data: [], error: null });
    await expect(registerPendingBankAccounts(NOW)).resolves.toEqual({
      checked: 0,
      verified: 0,
      rejected: 0,
      name_mismatch: 0,
      pending: 0,
      skipped: 0,
      error: 0,
    });
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("throws when the work list can't be loaded", async () => {
    queue("organization_bank_accounts", { data: null, error: { message: "db down" } });
    await expect(registerPendingBankAccounts(NOW)).rejects.toThrow(
      "failed to load pending bank accounts",
    );
  });
});

describe("settleBankAccountVerification", () => {
  it("matches the bank's name against the registered name, not the submitted holder", async () => {
    queueExpectedName("Persatuan Catur Kuala Lumpur");

    await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
      bankHolderName: "KL CHESS CLUB",
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "settle_bank_account_verification",
      expect.objectContaining({ p_name_matched: false }),
    );

    vi.clearAllMocks();
    queueExpectedName("Persatuan Catur Kuala Lumpur");
    await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
      bankHolderName: "PERSATUAN CATUR KUALA LUMPUR",
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "settle_bank_account_verification",
      expect.objectContaining({ p_name_matched: true }),
    );
  });

  it("checks a helper-entered account against the player's name, never the helper's (#718)", async () => {
    queue("organization_bank_accounts", { data: null, error: null });
    queue("player_bank_accounts", {
      data: {
        account_holder: "Hana Helper",
        entered_by: "helper-1",
        user: { first_name: "Aziz", last_name: "Adult" },
      },
      error: null,
    });
    mockRpc.mockResolvedValue({
      data: {
        owner: "player",
        organization_id: null,
        user_id: "u-1",
        already_processed: false,
        is_active: true,
        status: "name_mismatch",
      },
      error: null,
    });

    await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 85,
      verified: true,
      bankHolderName: "HANA HELPER",
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "settle_bank_account_verification",
      expect.objectContaining({ p_name_matched: false }),
    );
  });

  it("matches a helper-entered account held in the player's name (#718)", async () => {
    queue("organization_bank_accounts", { data: null, error: null });
    queue("player_bank_accounts", {
      data: {
        account_holder: "Aziz Adult",
        entered_by: "helper-1",
        user: { first_name: "Aziz", last_name: "Adult" },
      },
      error: null,
    });
    mockRpc.mockResolvedValue({
      data: {
        owner: "player",
        organization_id: null,
        user_id: "u-1",
        already_processed: false,
        is_active: true,
        status: "verified",
      },
      error: null,
    });

    await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 86,
      verified: true,
      bankHolderName: "AZIZ BIN ADULT",
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "settle_bank_account_verification",
      expect.objectContaining({ p_name_matched: true }),
    );
  });

  it("matches a player's account against the holder they submitted", async () => {
    queue("organization_bank_accounts", { data: null, error: null });
    queue("player_bank_accounts", {
      data: { account_holder: "Ahmad bin Ali" },
      error: null,
    });
    mockRpc.mockResolvedValue({
      data: {
        owner: "player",
        organization_id: null,
        user_id: "u-1",
        already_processed: false,
        is_active: true,
        status: "verified",
      },
      error: null,
    });

    const res = await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
      bankHolderName: "AHMAD B ALI",
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "settle_bank_account_verification",
      expect.objectContaining({ p_name_matched: true, p_bank_holder_name: "AHMAD B ALI" }),
    );
    expect(res.playerVerdict).toEqual({ userId: "u-1", verified: true });
  });

  it("treats a verified answer with no name as a mismatch", async () => {
    queueExpectedName();
    await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "settle_bank_account_verification",
      expect.objectContaining({ p_bank_holder_name: null, p_name_matched: false }),
    );
  });

  it("does not look up the expected name for a rejection", async () => {
    await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: false,
      reason: "Non-Active Status",
    });
    expect(mockFrom).not.toHaveBeenCalledWith("organization_registered_names");
    expect(mockRpc).toHaveBeenCalledWith(
      "settle_bank_account_verification",
      expect.objectContaining({ p_verified: false, p_name_matched: false }),
    );
  });

  it("returns the lookup error without settling when the expected name can't be loaded", async () => {
    queue("organization_bank_accounts", {
      data: null,
      error: { code: "XX000", message: "db down" },
    });
    const res = await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
      bankHolderName: "KL CHESS CLUB",
    });
    expect(res).toEqual({ error: { code: "XX000", message: "db down" }, settled: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("gives no player verdict while the account is under review", async () => {
    queue("organization_bank_accounts", { data: null, error: null });
    queue("player_bank_accounts", { data: { account_holder: "Ahmad" }, error: null });
    mockRpc.mockResolvedValue({
      data: {
        owner: "player",
        organization_id: null,
        user_id: "u-1",
        already_processed: false,
        is_active: true,
        status: "name_mismatch",
      },
      error: null,
    });
    const res = await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
      bankHolderName: "SOMEONE ELSE",
    });
    expect(res).toEqual({ error: null, settled: true, status: "name_mismatch" });
  });

  it("returns the RPC error without emailing", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    const res = await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: false,
    });
    expect(res).toEqual({ error: { code: "XX000", message: "boom" }, settled: false });
    await runAfterCallbacks();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not email on an already-processed repeat", async () => {
    mockRpc.mockResolvedValue({
      data: {
        organization_id: ORG_ID,
        already_processed: true,
        is_active: true,
        status: "verified",
      },
      error: null,
    });
    const res = await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
    });
    expect(res.settled).toBe(false);
    await runAfterCallbacks();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not email about a superseded account", async () => {
    mockRpc.mockResolvedValue({
      data: {
        organization_id: ORG_ID,
        already_processed: false,
        is_active: false,
        status: "verified",
      },
      error: null,
    });
    const res = await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
    });
    expect(res.settled).toBe(true);
    await runAfterCallbacks();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("an email failure does not fail the settlement", async () => {
    queueExpectedName();
    queueNotifyData("verified");
    mockSendEmail.mockRejectedValue(new Error("resend down"));
    const res = await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
      bankHolderName: "KL CHESS CLUB",
    });
    expect(res).toEqual({ error: null, settled: true, status: "verified" });
  });
});

describe("reviewBankAccountName", () => {
  const REVIEWER = "44444444-4444-4444-8444-444444444444";

  it("records the decision and emails the organization", async () => {
    queueNotifyData("verified");

    const res = await reviewBankAccountName({
      bankAccountId: BANK_ID,
      reviewerId: REVIEWER,
      action: "confirm",
      note: "Bank shortened the name",
    });

    expect(mockRpc).toHaveBeenCalledWith("review_bank_account_name", {
      p_bank_account_id: BANK_ID,
      p_reviewer_id: REVIEWER,
      p_action: "confirm",
      p_note: "Bank shortened the name",
    });
    expect(res).toEqual({ error: null, settled: true, status: "verified" });
    await runAfterCallbacks();
    expect(mockSendEmail).toHaveBeenCalled();
  });

  it("returns a player verdict for a player account", async () => {
    mockRpc.mockResolvedValue({
      data: {
        owner: "player",
        organization_id: null,
        user_id: "u-1",
        already_processed: false,
        is_active: true,
        status: "rejected",
      },
      error: null,
    });

    const res = await reviewBankAccountName({
      bankAccountId: BANK_ID,
      reviewerId: REVIEWER,
      action: "reject",
      note: "Not the player's account",
    });

    expect(res.playerVerdict).toEqual({ userId: "u-1", verified: false });
  });

  it("returns the RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "NOT_UNDER_REVIEW: x" },
    });
    const res = await reviewBankAccountName({
      bankAccountId: BANK_ID,
      reviewerId: REVIEWER,
      action: "confirm",
      note: "ok",
    });
    expect(res).toEqual({
      error: { code: "P0001", message: "NOT_UNDER_REVIEW: x" },
      settled: false,
    });
  });
});

describe("notifyBankVerification", () => {
  it("emails owner/admin members and the org address, deduped, last4 only", async () => {
    queueNotifyData("rejected", "Name mismatch");

    await notifyBankVerification(ORG_ID, BANK_ID);

    const to = mockSendEmail.mock.calls.map((c) => c[0]).sort();
    expect(to).toEqual(["Owner@x.com", "admin@x.com"]);

    const params = mockSendEmail.mock.calls[0][1];
    expect(params).toMatchObject({
      orgName: "KL Chess Club",
      orgId: ORG_ID,
      bankName: "Maybank",
      accountLast4: "2229",
      verified: false,
      rejectionReason: "Name mismatch",
    });
    expect(JSON.stringify(mockSendEmail.mock.calls)).not.toContain("157380112229");
  });

  it("emails nobody about an account that is under review", async () => {
    queueNotifyData("name_mismatch");
    await notifyBankVerification(ORG_ID, BANK_ID);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does nothing when member loading fails", async () => {
    queue("organization_memberships", { data: null, error: { message: "x" } });
    queue("organizations", { data: null, error: null });
    queue("organization_bank_accounts", { data: null, error: null });
    await notifyBankVerification(ORG_ID, BANK_ID);
    await runAfterCallbacks();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
