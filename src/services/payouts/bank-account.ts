import { supabaseAdmin } from "@/services/supabase/admin";
import {
  ChipSendError,
  chipBankAccountOutcome,
  registerChipBankAccount,
} from "@/services/chip/send";
import { sendBankVerificationEmail } from "@/services/email/email";
import { afterResponse } from "@/lib/http/after-response";
import { BANK_REGISTRATION_GRACE_MINUTES, PAYOUT_CONCURRENCY } from "./constants";
import { holderNamesMatch } from "./holder-name";

const NOTIFY_ROLES = ["owner", "admin"];

interface MembershipRecipient {
  user: { email: string | null; first_name: string | null } | null;
  roles: { name: string } | null;
}

export type BankAccountOwner = "organization" | "player";

const BANK_ACCOUNT_TABLE: Record<BankAccountOwner, string> = {
  organization: "organization_bank_accounts",
  player: "player_bank_accounts",
};

interface BankAccountRow {
  id: string;
  bank_code: string;
  bank_name: string;
  account_holder: string;
  account_number: string;
  status: BankAccountStatus;
  is_active: boolean;
  chip_bank_account_id: number | null;
}

export type BankAccountStatus = "pending" | "verified" | "rejected" | "name_mismatch";

function redactDigits(text: string): string {
  return text.replace(/\d{6,}/g, "[redacted]");
}

function describeError(err: unknown): string {
  if (err instanceof ChipSendError) {
    return `CHIP Send ${err.status}: ${redactDigits(err.body)}`;
  }
  return err instanceof Error ? redactDigits(err.message) : String(err);
}

export interface SettleBankAccountInput {
  bankAccountId: string;
  chipBankAccountId: number | null;
  verified: boolean;
  reason?: string | null;
  bankHolderName?: string | null;
}

type DbError = { code?: string; message: string };

export interface SettleBankAccountResult {
  error: DbError | null;
  settled: boolean;
  status?: BankAccountStatus;
  playerVerdict?: { userId: string; verified: boolean };
}

interface BankVerdictRow {
  owner?: BankAccountOwner;
  organization_id: string | null;
  user_id?: string | null;
  already_processed: boolean;
  is_active: boolean;
  status?: BankAccountStatus;
}

const toDbError = (e: { code?: string; message: string }): DbError => ({
  code: e.code,
  message: e.message,
});

export async function expectedHolderName(
  bankAccountId: string,
): Promise<{ name: string | null; error: DbError | null }> {
  const org = await supabaseAdmin
    .from("organization_bank_accounts")
    .select("account_holder, organization_id")
    .eq("id", bankAccountId)
    .maybeSingle();
  if (org.error) return { name: null, error: toDbError(org.error) };

  if (org.data) {
    const row = org.data as { account_holder: string; organization_id: string };
    const registered = await supabaseAdmin
      .from("organization_registered_names")
      .select("registered_name")
      .eq("organization_id", row.organization_id)
      .maybeSingle();
    if (registered.error) return { name: null, error: toDbError(registered.error) };
    const name = (registered.data as { registered_name: string } | null)?.registered_name;
    return { name: name ?? row.account_holder, error: null };
  }

  const player = await supabaseAdmin
    .from("player_bank_accounts")
    .select("account_holder")
    .eq("id", bankAccountId)
    .maybeSingle();
  if (player.error) return { name: null, error: toDbError(player.error) };
  return {
    name: (player.data as { account_holder: string } | null)?.account_holder ?? null,
    error: null,
  };
}

function afterBankVerdict(
  bankAccountId: string,
  result: BankVerdictRow,
): SettleBankAccountResult {
  const status = result.status;
  if (result.already_processed) return { error: null, settled: false, status };
  if (status !== "verified" && status !== "rejected") {
    return { error: null, settled: true, status };
  }

  if (result.is_active && result.owner !== "player" && result.organization_id) {
    const organizationId = result.organization_id;
    afterResponse(async () => {
      try {
        await notifyBankVerification(organizationId, bankAccountId);
      } catch (err) {
        console.error(
          `Bank account ${bankAccountId}: verification email failed`,
          describeError(err),
        );
      }
    });
  }

  if (result.owner === "player" && result.is_active && result.user_id) {
    return {
      error: null,
      settled: true,
      status,
      playerVerdict: { userId: result.user_id, verified: status === "verified" },
    };
  }
  return { error: null, settled: true, status };
}

export async function settleBankAccountVerification(
  input: SettleBankAccountInput,
): Promise<SettleBankAccountResult> {
  let nameMatched = false;
  if (input.verified) {
    const expected = await expectedHolderName(input.bankAccountId);
    if (expected.error) return { error: expected.error, settled: false };
    nameMatched = holderNamesMatch(input.bankHolderName, expected.name);
  }

  const { data, error } = await supabaseAdmin.rpc(
    "settle_bank_account_verification",
    {
      p_bank_account_id: input.bankAccountId,
      p_chip_bank_account_id: input.chipBankAccountId,
      p_verified: input.verified,
      p_reason: input.reason ?? null,
      p_bank_holder_name: input.bankHolderName ?? null,
      p_name_matched: nameMatched,
    },
  );

  if (error) return { error: toDbError(error), settled: false };

  const result = data as BankVerdictRow;
  if (result.status === "name_mismatch" && !result.already_processed) {
    console.warn(
      `Bank account ${input.bankAccountId}: verified by CHIP in a holder name that doesn't match; held for admin review`,
    );
  }
  return afterBankVerdict(input.bankAccountId, result);
}

export type BankNameReviewAction = "confirm" | "reject";

export async function reviewBankAccountName(input: {
  bankAccountId: string;
  reviewerId: string;
  action: BankNameReviewAction;
  note: string;
}): Promise<SettleBankAccountResult> {
  const { data, error } = await supabaseAdmin.rpc("review_bank_account_name", {
    p_bank_account_id: input.bankAccountId,
    p_reviewer_id: input.reviewerId,
    p_action: input.action,
    p_note: input.note,
  });

  if (error) return { error: toDbError(error), settled: false };
  return afterBankVerdict(input.bankAccountId, data as BankVerdictRow);
}

export async function notifyBankVerification(
  organizationId: string,
  bankAccountId: string,
): Promise<void> {
  const [membersRes, orgRes, bankRes] = await Promise.all([
    supabaseAdmin
      .from("organization_memberships")
      .select("user:users(email, first_name), roles!inner(name)")
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("organizations")
      .select("name, email")
      .eq("id", organizationId)
      .single(),
    supabaseAdmin
      .from("organization_bank_accounts")
      .select("bank_name, account_number, status, rejection_reason")
      .eq("id", bankAccountId)
      .single(),
  ]);

  if (membersRes.error || bankRes.error || !bankRes.data) {
    console.error(
      `Bank account ${bankAccountId}: failed to load verification email data`,
      membersRes.error?.message ?? bankRes.error?.message,
    );
    return;
  }

  const bank = bankRes.data as {
    bank_name: string;
    account_number: string;
    status: string;
    rejection_reason: string | null;
  };
  if (bank.status !== "verified" && bank.status !== "rejected") return;

  const org = orgRes.data as { name: string | null; email: string | null } | null;
  const orgName = org?.name ?? "your organization";

  const recipients = new Map<string, { email: string; name: string }>();
  for (const m of membersRes.data as unknown as MembershipRecipient[]) {
    if (!m.roles || !NOTIFY_ROLES.includes(m.roles.name)) continue;
    const email = m.user?.email;
    if (!email) continue;
    recipients.set(email.toLowerCase(), {
      email,
      name: m.user?.first_name ?? "there",
    });
  }
  if (org?.email && !recipients.has(org.email.toLowerCase())) {
    recipients.set(org.email.toLowerCase(), { email: org.email, name: orgName });
  }

  const accountLast4 = bank.account_number.slice(-4);
  const verified = bank.status === "verified";

  const results = await Promise.allSettled(
    [...recipients.values()].map((r) =>
      sendBankVerificationEmail(r.email, {
        recipientName: r.name,
        orgName,
        orgId: organizationId,
        bankName: bank.bank_name,
        accountLast4,
        verified,
        rejectionReason: verified ? undefined : (bank.rejection_reason ?? undefined),
      }),
    ),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.error(
      `Failed to send ${failed}/${recipients.size} bank verification email(s) for org ${organizationId}`,
    );
  }
}

export type BankRegistrationOutcome =
  | "verified"
  | "rejected"
  | "name_mismatch"
  | "pending"
  | "skipped"
  | "error";

export function registerOrganizationBankAccount(
  bankAccountId: string,
): Promise<BankRegistrationOutcome> {
  return registerBankAccount("organization", bankAccountId);
}

export function registerPlayerBankAccount(
  bankAccountId: string,
): Promise<BankRegistrationOutcome> {
  return registerBankAccount("player", bankAccountId);
}

async function registerBankAccount(
  owner: BankAccountOwner,
  bankAccountId: string,
): Promise<BankRegistrationOutcome> {
  const table = BANK_ACCOUNT_TABLE[owner];
  try {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(
        "id, bank_code, bank_name, account_holder, account_number, status, is_active, chip_bank_account_id",
      )
      .eq("id", bankAccountId)
      .maybeSingle();

    if (error) {
      console.error(
        `Bank account ${bankAccountId}: failed to load for CHIP registration`,
        error.message,
      );
      return "error";
    }

    const row = data as BankAccountRow | null;
    if (!row) {
      console.warn(`Bank account ${bankAccountId}: not found; not registered`);
      return "skipped";
    }
    if (!row.is_active || row.status !== "pending") {
      console.info(
        `Bank account ${bankAccountId}: ${row.is_active ? row.status : "superseded"}; not registered`,
      );
      return "skipped";
    }

    let chipAccount;
    try {
      chipAccount = await registerChipBankAccount({
        account_number: row.account_number,
        bank_code: row.bank_code,
        name: row.account_holder,
        reference: row.id,
      });
    } catch (err) {
      console.error(
        `Bank account ${bankAccountId}: CHIP registration failed; left pending`,
        describeError(err),
      );
      return "error";
    }

    const { error: updateError } = await supabaseAdmin
      .from(table)
      .update({ chip_bank_account_id: chipAccount.id })
      .eq("id", row.id);
    if (updateError) {
      console.error(
        `Bank account ${bankAccountId}: failed to persist chip_bank_account_id ${chipAccount.id}`,
        updateError.message,
      );
    }

    const outcome = chipBankAccountOutcome(chipAccount.status);
    if (outcome === "pending") {
      console.info(
        `Bank account ${bankAccountId}: CHIP returned ${chipAccount.status}; awaiting webhook`,
      );
      return "pending";
    }

    const { error: settleError, status } = await settleBankAccountVerification({
      bankAccountId: row.id,
      chipBankAccountId: chipAccount.id,
      verified: outcome === "verified",
      reason: chipAccount.rejection_reason,
      bankHolderName: chipAccount.name,
    });
    if (settleError) {
      console.error(
        `Bank account ${bankAccountId}: settle_bank_account_verification failed`,
        settleError.message,
      );
      return "error";
    }
    return status === "name_mismatch" ? "name_mismatch" : outcome;
  } catch (err) {
    console.error(
      `Bank account ${bankAccountId}: unexpected error during CHIP registration`,
      describeError(err),
    );
    return "error";
  }
}

export async function registerActiveOrganizationBankAccount(
  organizationId: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("organization_bank_accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error(
      `Org ${organizationId}: failed to load active bank account for CHIP registration`,
      error.message,
    );
    return;
  }
  if (!data) {
    console.warn(`Org ${organizationId}: approved with no active bank account`);
    return;
  }

  await registerOrganizationBankAccount((data as { id: string }).id);
}

export interface BankRegistrationStats extends Record<BankRegistrationOutcome, number> {
  checked: number;
}

export async function registerPendingBankAccounts(
  now: Date = new Date(),
): Promise<BankRegistrationStats> {
  const cutoff = new Date(now.getTime() - BANK_REGISTRATION_GRACE_MINUTES * 60_000);
  const { data, error } = await supabaseAdmin
    .from("organization_bank_accounts")
    .select("id, organizations!inner(approval_status)")
    .eq("is_active", true)
    .eq("status", "pending")
    .eq("organizations.approval_status", "approved")
    .lt("created_at", cutoff.toISOString())
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`failed to load pending bank accounts: ${error.message}`, {
      cause: error,
    });
  }

  const rows = (data ?? []) as { id: string }[];
  const stats: BankRegistrationStats = {
    checked: rows.length,
    verified: 0,
    rejected: 0,
    name_mismatch: 0,
    pending: 0,
    skipped: 0,
    error: 0,
  };
  for (let i = 0; i < rows.length; i += PAYOUT_CONCURRENCY) {
    const batch = rows.slice(i, i + PAYOUT_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((row) => registerOrganizationBankAccount(row.id)),
    );
    for (const outcome of outcomes) stats[outcome]++;
  }
  return stats;
}
