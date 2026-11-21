"use client";

import { useState } from "react";
import BankAccountFields, {
  normalizeAccountNumber,
  validateBankAccount,
  type BankAccountValues,
} from "@/components/BankAccountFields";
import { MALAYSIAN_BANKS } from "@/lib/reference/malaysian-banks";
import type { BankAccountStatus } from "@/app/profile/types";
import SensitiveDataConsent, {
  recordSensitiveDataConsent,
} from "@/components/SensitiveDataConsent";

export type BankingDisplay = {
  bank_name: string | null;
  bank_code: string | null;
  bank_account_holder: string | null;
  bank_account_number_last4: string | null;
  bank_account_status: BankAccountStatus | null;
  bank_account_rejection_reason: string | null;
};

interface SavedBankAccount {
  bank_name: string;
  bank_code: string;
  account_holder: string;
  account_number_last4: string;
  status: BankAccountStatus;
  rejection_reason: string | null;
}

interface Props {
  initial?: BankingDisplay;
  onSaved: (masked: BankingDisplay) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

export default function BankingForm({
  initial,
  onSaved,
  onCancel,
  submitLabel = "Save",
}: Props) {
  const [values, setValues] = useState<BankAccountValues>({
    bankName: initial?.bank_name ?? "",
    bankCode: initial?.bank_code ?? "",
    accountHolder: initial?.bank_account_holder ?? "",
    accountNumber: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);

  function update(patch: Partial<BankAccountValues>) {
    setValues((prev) => ({ ...prev, ...patch }));
    setError(null);
  }

  async function handleSubmit() {
    const validationError = validateBankAccount(values, {
      requireBankCode: true,
    });
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!consented) {
      setError("Please tick the consent box to save your bank details.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const digits = normalizeAccountNumber(values.accountNumber);
    try {
      const consentError = await recordSensitiveDataConsent("financial");
      if (consentError) {
        setError(consentError);
        return;
      }

      const res = await fetch("/api/v1/profile/banking", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_code: values.bankCode,
          account_holder: values.accountHolder.trim(),
          account_number: digits,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? "Save failed. Please try again.");
        return;
      }
      const saved = json?.data as SavedBankAccount | null;
      onSaved({
        bank_name: saved?.bank_name ?? null,
        bank_code: saved?.bank_code ?? values.bankCode,
        bank_account_holder: saved?.account_holder ?? values.accountHolder.trim(),
        bank_account_number_last4:
          saved?.account_number_last4 ?? digits.slice(-4),
        bank_account_status: saved?.status ?? "pending",
        bank_account_rejection_reason: saved?.rejection_reason ?? null,
      });
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <BankAccountFields
        values={values}
        onChange={update}
        banks={MALAYSIAN_BANKS}
        existingLast4={initial?.bank_account_number_last4 ?? null}
        disabled={submitting}
      />

      <SensitiveDataConsent
        category="financial"
        checked={consented}
        disabled={submitting}
        onChange={(checked) => {
          setConsented(checked);
          setError(null);
        }}
      />

      {error && <p className="font-lato text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        {onCancel && (
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn-primary w-full"
          onClick={handleSubmit}
          disabled={submitting || !consented}
          aria-disabled={submitting || !consented}
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
