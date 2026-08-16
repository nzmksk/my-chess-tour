"use client";

import type { MalaysianBank } from "@/lib/malaysian-banks";

// The three fields that identify a payout destination, plus the rules that
// govern them. Extracted from BankingForm so the organizer application, the
// organization settings page and the player settings card all collect the same
// shape and validate it identically — a player's account number and an
// organization's must obey the same digit rule, because they end up on the same
// payment rails.
//
// Deliberately presentation-only: it owns no submit. The player card PATCHes
// one endpoint, the settings card PUTs another, and the application form sends
// these fields inside a much larger POST. A component that owned the request
// could only serve the first of those.

export interface BankAccountValues {
  /** Display name. In select mode the server derives this from bankCode. */
  bankName: string;
  /** SWIFT/BIC. Empty in free-text mode. */
  bankCode: string;
  accountHolder: string;
  accountNumber: string;
}

/**
 * Spaces and dashes are how people write account numbers off a bank statement;
 * the column stores digits only. Identical to the rule in
 * PATCH /api/v1/profile/banking, which is the point of it being here.
 */
export function normalizeAccountNumber(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export const ACCOUNT_NUMBER_PATTERN = /^\d{5,20}$/;

/**
 * Returns the first problem with these values, or null if they're fine.
 *
 * `requireBankCode` is what distinguishes an organization payout destination
 * (must be a bank CHIP Send knows, chosen from the list) from a player's
 * free-text bank name.
 */
export function validateBankAccount(
  values: BankAccountValues,
  { requireBankCode }: { requireBankCode: boolean },
): string | null {
  if (requireBankCode) {
    if (!values.bankCode) return "Please choose your bank.";
  } else {
    if (!values.bankName.trim()) return "Please enter your bank name.";
    if (values.bankName.trim().length > 100)
      return "Bank name must be 100 characters or fewer.";
  }
  if (!values.accountHolder.trim())
    return "Please enter the account holder name.";
  if (values.accountHolder.trim().length > 255)
    return "Account holder name must be 255 characters or fewer.";
  if (!ACCOUNT_NUMBER_PATTERN.test(normalizeAccountNumber(values.accountNumber)))
    return "Account number must contain 5 to 20 digits.";
  return null;
}

interface Props {
  values: BankAccountValues;
  onChange: (patch: Partial<BankAccountValues>) => void;
  /**
   * Present → the bank is chosen from this list and `bankCode` is what the
   * caller submits. Absent → free-text `bankName`, the player-profile shape.
   */
  banks?: readonly MalaysianBank[];
  /** Last 4 of an already-stored number, shown as the placeholder. */
  existingLast4?: string | null;
  /** Distinguishes input ids when more than one instance is on a page. */
  idPrefix?: string;
  disabled?: boolean;
}

export default function BankAccountFields({
  values,
  onChange,
  banks,
  existingLast4,
  idPrefix = "bank",
  disabled = false,
}: Props) {
  return (
    <>
      <div className="form-group">
        <div className="label-row">
          <label className="input-label" htmlFor={`${idPrefix}_name`}>
            Bank
          </label>
        </div>
        {banks ? (
          <select
            id={`${idPrefix}_name`}
            className="input"
            value={values.bankCode}
            disabled={disabled}
            onChange={(e) => onChange({ bankCode: e.target.value })}
          >
            <option value="">Select your bank…</option>
            {banks.map((bank) => (
              <option key={bank.swift} value={bank.swift}>
                {bank.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`${idPrefix}_name`}
            className="input"
            type="text"
            placeholder="e.g. Maybank"
            value={values.bankName}
            maxLength={100}
            disabled={disabled}
            onChange={(e) => onChange({ bankName: e.target.value })}
          />
        )}
      </div>

      <div className="form-group">
        <div className="label-row">
          <label className="input-label" htmlFor={`${idPrefix}_account_holder`}>
            Account Holder Name
          </label>
        </div>
        <input
          id={`${idPrefix}_account_holder`}
          className="input"
          type="text"
          placeholder="Name as it appears on the account"
          value={values.accountHolder}
          maxLength={255}
          disabled={disabled}
          onChange={(e) => onChange({ accountHolder: e.target.value })}
        />
      </div>

      <div className="form-group">
        <div className="label-row">
          <label className="input-label" htmlFor={`${idPrefix}_account_number`}>
            Account Number
          </label>
        </div>
        <input
          id={`${idPrefix}_account_number`}
          className="input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={
            existingLast4
              ? `•••• ${existingLast4} — re-enter to change`
              : "e.g. 1234567890"
          }
          value={values.accountNumber}
          disabled={disabled}
          onChange={(e) =>
            onChange({ accountNumber: e.target.value.replace(/[^\d\s-]/g, "") })
          }
        />
      </div>
    </>
  );
}
