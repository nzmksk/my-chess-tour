import { beforeEach, describe, expect, it, vi } from "vitest";

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
      for (const m of ["select", "eq", "maybeSingle", "single"]) {
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

    await registerOrganizationBankAccount(BANK_ID);

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

    await registerOrganizationBankAccount(BANK_ID);

    expect(mockRpc).toHaveBeenCalledWith("settle_bank_account_verification", {
      p_bank_account_id: BANK_ID,
      p_chip_bank_account_id: 84,
      p_verified: true,
      p_reason: null,
    });
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

    await registerOrganizationBankAccount(BANK_ID);

    expect(mockRpc).toHaveBeenCalledWith(
      "settle_bank_account_verification",
      expect.objectContaining({ p_verified: false, p_reason: "Invalid account" }),
    );
  });

  it("treats an unverified sync response as pending", async () => {
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    queue("organization_bank_accounts", { data: null, error: null });
    mockRegister.mockResolvedValue({ id: 84, status: "unverified", rejection_reason: null });

    await registerOrganizationBankAccount(BANK_ID);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["verified", { ...pendingRow, status: "verified" }],
    ["rejected", { ...pendingRow, status: "rejected" }],
    ["superseded", { ...pendingRow, is_active: false }],
    ["missing", null],
  ])("skips a %s row without calling CHIP", async (_label, row) => {
    queue("organization_bank_accounts", { data: row, error: null });
    await registerOrganizationBankAccount(BANK_ID);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("never throws when CHIP fails, and keeps account digits out of logs", async () => {
    queue("organization_bank_accounts", { data: pendingRow, error: null });
    mockRegister.mockRejectedValue(
      new ChipSendError(400, '{"account_number":"157380112229 is invalid"}'),
    );

    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBeUndefined();

    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("400");
    expect(logged).not.toContain("157380112229");
    expect(updates).toHaveLength(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("never throws when the row load fails", async () => {
    queue("organization_bank_accounts", { data: null, error: { message: "db down" } });
    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBeUndefined();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("never throws on an unexpected error", async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error("kaboom");
    });
    await expect(registerOrganizationBankAccount(BANK_ID)).resolves.toBeUndefined();
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
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
