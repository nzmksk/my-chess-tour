"use client";

import { useState } from "react";

// Masked view of a player's banking details — what the API returns and what the
// UI renders. The full account number is never held here.
export type BankingDisplay = {
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_account_number_last4: string | null;
};

interface Props {
  initial?: BankingDisplay;
  onSaved: (masked: BankingDisplay) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

// Reusable banking-details collector. Submits to the shared
// PATCH /api/v1/profile/banking endpoint. Used by the settings BankingCard and
// available for a future just-in-time prize-claim / refund surface. The account
// number is always re-entered in full (the existing value is masked and never
// sent back to the client).
export default function BankingForm({
  initial,
  onSaved,
  onCancel,
  submitLabel = "Save",
}: Props) {
  const hasExistingNumber = Boolean(initial?.bank_account_number_last4);

  const [bankName, setBankName] = useState(initial?.bank_name ?? "");
  const [holder, setHolder] = useState(initial?.bank_account_holder ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!bankName.trim()) return "Please enter your bank name.";
    if (bankName.trim().length > 100)
      return "Bank name must be 100 characters or fewer.";
    if (!holder.trim()) return "Please enter the account holder name.";
    if (holder.trim().length > 255)
      return "Account holder name must be 255 characters or fewer.";
    const digits = accountNumber.replace(/[\s-]/g, "");
    if (!/^\d{5,20}$/.test(digits))
      return "Account number must contain 5 to 20 digits.";
    return null;
  }

  async function handleSubmit() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    const digits = accountNumber.replace(/[\s-]/g, "");
    try {
      const res = await fetch("/api/v1/profile/banking", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_name: bankName.trim(),
          bank_account_holder: holder.trim(),
          bank_account_number: digits,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "Save failed. Please try again.");
        return;
      }
      onSaved({
        bank_name: bankName.trim(),
        bank_account_holder: holder.trim(),
        bank_account_number_last4: digits.slice(-4),
      });
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="form-group">
        <div className="label-row">
          <label className="input-label" htmlFor="bank_name">
            Bank Name
          </label>
        </div>
        <input
          id="bank_name"
          className="input"
          type="text"
          placeholder="e.g. Maybank"
          value={bankName}
          maxLength={100}
          onChange={(e) => {
            setBankName(e.target.value);
            setError(null);
          }}
        />
      </div>

      <div className="form-group">
        <div className="label-row">
          <label className="input-label" htmlFor="bank_account_holder">
            Account Holder Name
          </label>
        </div>
        <input
          id="bank_account_holder"
          className="input"
          type="text"
          placeholder="Name as it appears on the account"
          value={holder}
          maxLength={255}
          onChange={(e) => {
            setHolder(e.target.value);
            setError(null);
          }}
        />
      </div>

      <div className="form-group">
        <div className="label-row">
          <label className="input-label" htmlFor="bank_account_number">
            Account Number
          </label>
        </div>
        <input
          id="bank_account_number"
          className="input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={
            hasExistingNumber
              ? `•••• ${initial?.bank_account_number_last4} — re-enter to change`
              : "e.g. 1234567890"
          }
          value={accountNumber}
          onChange={(e) => {
            setAccountNumber(e.target.value.replace(/[^\d\s-]/g, ""));
            setError(null);
          }}
        />
      </div>

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
          disabled={submitting}
          aria-disabled={submitting}
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
