import { supabaseAdmin } from "@/services/supabase/admin";
import {
  ChipSendError,
  chipBankAccountOutcome,
  registerChipBankAccount,
} from "@/services/chip/send";
import { sendBankVerificationEmail } from "@/services/email/email";

// Payout bank account verification (#519).
//
// An organization's bank account is registered with CHIP Send only once the
// organization is APPROVED — never at application time. Registering an
// unapproved applicant's account wastes a CHIP verification (which carries a
// fee) and discloses pending applicants to the PSP.
//
// Verification then completes on one of two paths, which must agree:
//   * synchronously, when POST /send/bank_accounts already answers verified or
//     rejected (registerOrganizationBankAccount below);
//   * asynchronously, via the CHIP Send webhook (webhooks/chip/send/route.ts).
// Both classify with chipBankAccountOutcome and settle through
// settleBankAccountVerification, whose RPC makes the first verdict stick.

// Owner/admin members are the ones who can act on a payout problem — the same
// roles notified of cancellation reviews.
const NOTIFY_ROLES = ["owner", "admin"];

interface MembershipRecipient {
  user: { email: string | null; first_name: string | null } | null;
  roles: { name: string } | null;
}

interface BankAccountRow {
  id: string;
  organization_id: string;
  bank_code: string;
  bank_name: string;
  account_holder: string;
  account_number: string;
  status: "pending" | "verified" | "rejected";
  is_active: boolean;
  chip_bank_account_id: number | null;
}

// CHIP error bodies can echo the submitted account number; keep long digit runs
// out of the logs.
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
}

export interface SettleBankAccountResult {
  /** Set when the RPC failed — the caller decides whether that is retryable. */
  error: { code?: string; message: string } | null;
  /** True when this call changed the row (false for a no-op repeat). */
  settled: boolean;
}

/**
 * Settles CHIP's verdict via settle_bank_account_verification and, when this
 * call is the one that changed the row and the account is still the
 * organization's active one, emails the owners/admins. The email is
 * best-effort; only the RPC outcome is reported back.
 */
export async function settleBankAccountVerification(
  input: SettleBankAccountInput,
): Promise<SettleBankAccountResult> {
  const { data, error } = await supabaseAdmin.rpc(
    "settle_bank_account_verification",
    {
      p_bank_account_id: input.bankAccountId,
      p_chip_bank_account_id: input.chipBankAccountId,
      p_verified: input.verified,
      p_reason: input.reason ?? null,
    },
  );

  if (error) {
    return { error: { code: error.code, message: error.message }, settled: false };
  }

  const result = data as {
    organization_id: string;
    already_processed: boolean;
    is_active: boolean;
  };

  if (result.already_processed) return { error: null, settled: false };

  // An account the organizer already replaced: record the verdict, stay quiet.
  if (result.is_active) {
    try {
      await notifyBankVerification(result.organization_id, input.bankAccountId);
    } catch (err) {
      console.error(
        `Bank account ${input.bankAccountId}: verification email failed`,
        describeError(err),
      );
    }
  }

  return { error: null, settled: true };
}

/**
 * Emails the organization's owner/admin members plus its contact address
 * (organizations.email) about the verdict on a bank account, deduplicated by
 * lowercased address. Failures are logged, never thrown.
 */
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
  if (bank.status === "pending") return;

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

  // Last 4 only — the full number never leaves this function.
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

/**
 * Registers a bank account with CHIP Send and records the result:
 *   1. load the row (service role) — skipped unless it is active and pending;
 *   2. POST /send/bank_accounts with `reference` = our row id, so a retry
 *      returns CHIP's existing record instead of creating a second recipient;
 *   3. persist CHIP's integer id as chip_bank_account_id;
 *   4. a synchronous `verified`/`rejected` is settled now; anything else is
 *      left `pending` for the webhook.
 *
 * NEVER throws — it runs after the approval has committed, exactly like
 * processCancellationRefund. Failures are logged and the row stays `pending`,
 * so re-running is safe.
 */
export async function registerOrganizationBankAccount(
  bankAccountId: string,
): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("organization_bank_accounts")
      .select(
        "id, organization_id, bank_code, bank_name, account_holder, account_number, status, is_active, chip_bank_account_id",
      )
      .eq("id", bankAccountId)
      .maybeSingle();

    if (error) {
      console.error(
        `Bank account ${bankAccountId}: failed to load for CHIP registration`,
        error.message,
      );
      return;
    }

    const row = data as BankAccountRow | null;
    if (!row) {
      console.warn(`Bank account ${bankAccountId}: not found; not registered`);
      return;
    }
    if (!row.is_active || row.status !== "pending") {
      console.info(
        `Bank account ${bankAccountId}: ${row.is_active ? row.status : "superseded"}; not registered`,
      );
      return;
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
      return;
    }

    const { error: updateError } = await supabaseAdmin
      .from("organization_bank_accounts")
      .update({ chip_bank_account_id: chipAccount.id })
      .eq("id", row.id);
    if (updateError) {
      // Not fatal: the settle RPC below records the id too, and the webhook
      // correlates on `reference` (our row id) first.
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
      return;
    }

    const { error: settleError } = await settleBankAccountVerification({
      bankAccountId: row.id,
      chipBankAccountId: chipAccount.id,
      verified: outcome === "verified",
      reason: chipAccount.rejection_reason,
    });
    if (settleError) {
      console.error(
        `Bank account ${bankAccountId}: settle_bank_account_verification failed`,
        settleError.message,
      );
    }
  } catch (err) {
    console.error(
      `Bank account ${bankAccountId}: unexpected error during CHIP registration`,
      describeError(err),
    );
  }
}

/**
 * Registers the organization's ACTIVE bank account. The entry point for the
 * application-approval route, which knows the organization but not the row.
 * Never throws.
 */
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
