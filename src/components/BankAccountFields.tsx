"use client";

import {
  accountNumberLengthError,
  type MalaysianBank,
} from "@/lib/reference/malaysian-banks";

export interface BankAccountValues {
  bankName: string;
  bankCode: string;
  accountHolder: string;
  accountNumber: string;
}

export function normalizeAccountNumber(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export const ACCOUNT_NUMBER_PATTERN = /^\d{5,20}$/;

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
  const accountNumber = normalizeAccountNumber(values.accountNumber);
  if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber))
    return "Account number must contain 5 to 20 digits.";
  if (requireBankCode) {
    const lengthError = accountNumberLengthError(values.bankCode, accountNumber);
    if (lengthError) return `${lengthError}.`;
  }
  return null;
}

interface Props {
  values: BankAccountValues;
  onChange: (patch: Partial<BankAccountValues>) => void;
  banks?: readonly MalaysianBank[];
  existingLast4?: string | null;
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
