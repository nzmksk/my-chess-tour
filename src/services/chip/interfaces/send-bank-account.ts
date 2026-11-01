/** Body of `POST /send/bank_accounts` (register a payout recipient). */
export interface ChipBankAccountRequest {
  /** Digits only, no spaces or dashes. Length depends on the bank. */
  account_number: string;
  /** SWIFT/BIC — must be one of the codes in src/lib/malaysian-banks.ts. */
  bank_code: string;
  /** Account holder name as it appears at the bank. */
  name: string;
  /**
   * Idempotency key: a duplicate `reference` returns the existing record
   * instead of creating a second recipient. We send
   * organization_bank_accounts.id, which is stable across retries.
   */
  reference: string;
}

/**
 * Verification status of a registered recipient. The spec's enum is
 * pending | verified | rejected; anything else is treated as pending by
 * `chipBankAccountOutcome`.
 */
export type ChipBankAccountStatus = "pending" | "verified" | "rejected";

/** A registered recipient bank account (create/retrieve response). */
export interface ChipBankAccount {
  /** CHIP's integer id — persisted as organization_bank_accounts.chip_bank_account_id. */
  id: number;
  status: ChipBankAccountStatus;
  account_number: string;
  bank_code: string;
  group_id: number | null;
  name: string;
  reference: string | null;
  created_at: string;
  is_debiting_account: boolean;
  is_crediting_account: boolean;
  updated_at: string;
  deleted_at: string | null;
  /** Populated when `status` is `rejected`. */
  rejection_reason: string | null;
}
