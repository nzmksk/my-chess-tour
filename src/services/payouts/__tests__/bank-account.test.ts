import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAfterCallbacks } from "@/test/after";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, tables, updates, mockRegister, mockSendEmail } =
  vi.hoisted(() => {
    // Per-table queued results; each `from(table)` call consumes the next one.
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
  settleBankAccountVerification,
} from "../bank-account";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function queueNotifyData(status: "verified" | "rejected", reason: string | null = null) {
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
    data: { organization_id: ORG_ID, already_processed: false, is_active: true },
    error: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// registerOrganizationBankAccount
// ---------------------------------------------------------------------------

describe("registerOrganizationBankAccount", () => {
  it("registers with our row id as the reference and persists CHIP's id", async () => {
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    queue("organization_bank_accounts", { data: null, error: null }); // update
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
    // Pending → wait for the webhook, no settlement.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("settles immediately when CHIP answers verified synchronously", async () => {
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    queue("organization_bank_accounts", { data: null, error: null });
    mockRegister.mockResolvedValue({ id: 84, status: "verified", rejection_reason: null });
    queueNotifyData("verified");

    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBe("verified");

    expect(mockRpc).toHaveBeenCalledWith("settle_bank_account_verification", {
      p_bank_account_id: BANK_ID,
      p_chip_bank_account_id: 84,
      p_verified: true,
      p_reason: null,
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

// ---------------------------------------------------------------------------
// registerPendingBankAccounts
// ---------------------------------------------------------------------------

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
    // Registered-but-unsettled accounts too: a re-post returns CHIP's current verdict.
    expect(builder.is).not.toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("organizations.approval_status", "approved");
    expect(builder.lt).toHaveBeenCalledWith("created_at", "2026-11-17T00:45:00.000Z");
  });

  it("registers each row and counts what each came to", async () => {
    const OTHER_ID = "33333333-3333-4333-8333-333333333333";
    queue(
      "organization_bank_accounts",
      { data: [{ id: BANK_ID }, { id: OTHER_ID }], error: null },
      // BANK_ID: load, then the chip id update. OTHER_ID: load fails.
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
    // A synchronous verdict whose settle failed earlier: the id was saved, the
    // row is still pending.
    queue(
      "organization_bank_accounts",
      { data: [{ id: BANK_ID }], error: null },
      { data: { ...pendingRow, chip_bank_account_id: 84 }, error: null },
      { data: null, error: null },
    );
    mockRegister.mockResolvedValue({ id: 84, status: "verified", rejection_reason: null });
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

// ---------------------------------------------------------------------------
// settleBankAccountVerification
// ---------------------------------------------------------------------------

describe("settleBankAccountVerification", () => {
  it("returns the RPC error without emailing", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    const res = await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
    });
    expect(res).toEqual({ error: { code: "XX000", message: "boom" }, settled: false });
    await runAfterCallbacks();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not email on an already-processed repeat", async () => {
    mockRpc.mockResolvedValue({
      data: { organization_id: ORG_ID, already_processed: true, is_active: true },
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
      data: { organization_id: ORG_ID, already_processed: false, is_active: false },
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
    queueNotifyData("verified");
    mockSendEmail.mockRejectedValue(new Error("resend down"));
    const res = await settleBankAccountVerification({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
    });
    expect(res).toEqual({ error: null, settled: true });
  });
});

// ---------------------------------------------------------------------------
// notifyBankVerification
// ---------------------------------------------------------------------------

describe("notifyBankVerification", () => {
  it("emails owner/admin members and the org address, deduped, last4 only", async () => {
    queueNotifyData("rejected", "Name mismatch");

    await notifyBankVerification(ORG_ID, BANK_ID);

    const to = mockSendEmail.mock.calls.map((c) => c[0]).sort();
    // owner@x.com (org email) dedupes against Owner@x.com; member is excluded.
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

  it("does nothing when member loading fails", async () => {
    queue("organization_memberships", { data: null, error: { message: "x" } });
    queue("organizations", { data: null, error: null });
    queue("organization_bank_accounts", { data: null, error: null });
    await notifyBankVerification(ORG_ID, BANK_ID);
    await runAfterCallbacks();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
