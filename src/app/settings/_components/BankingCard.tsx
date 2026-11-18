"use client";

import { useState } from "react";
import BankingForm, { type BankingDisplay } from "@/components/BankingForm";
import type { BankAccountStatus } from "@/app/profile/types";

interface Props {
  bankName: string | null;
  bankCode: string | null;
  accountHolder: string | null;
  accountNumberLast4: string | null;
  status: BankAccountStatus | null;
  rejectionReason: string | null;
}

// A player's account is checked with their bank only when a prize is to be
// sent to it, so "pending" is the normal resting state, not a problem.
const STATUS_COPY: Record<BankAccountStatus, { label: string; note: string; className: string }> = {
  pending: {
    label: "Not yet verified",
    note: "We verify it with your bank when you win a prize paid through MY Chess Tour.",
    className: "text-text-muted",
  },
  verified: {
    label: "Verified",
    note: "Prizes paid through MY Chess Tour are sent to this account.",
    className: "text-success",
  },
  rejected: {
    label: "Could not be verified",
    note: "Please check the details and save them again, or prizes can't be sent to you.",
    className: "text-danger",
  },
};

// Banking / payout details card. Kept outside the main profile edit form because
// these fields are freely editable (not set-once) and sensitive: the account
// number is masked on display and re-entered in full to change. Mirrors the
// self-contained OkuVerificationCard shape.
//
// Removing the details is how a player withdraws their financial-data consent
// (#451): PATCH with every field null deactivates the account and records the
// withdrawal in the same transaction.
export default function BankingCard({
  bankName: initialBankName,
  bankCode: initialBankCode,
  accountHolder: initialAccountHolder,
  accountNumberLast4: initialLast4,
  status: initialStatus,
  rejectionReason: initialRejectionReason,
}: Props) {
  const [display, setDisplay] = useState<BankingDisplay>({
    bank_name: initialBankName,
    bank_code: initialBankCode,
    bank_account_holder: initialAccountHolder,
    bank_account_number_last4: initialLast4,
    bank_account_status: initialStatus,
    bank_account_rejection_reason: initialRejectionReason,
  });
  const statusCopy = display.bank_account_status
    ? STATUS_COPY[display.bank_account_status]
    : null;
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const hasDetails = Boolean(
    display.bank_name ||
    display.bank_account_holder ||
    display.bank_account_number_last4,
  );

  function handleSaved(masked: BankingDisplay) {
    setDisplay(masked);
    setEditing(false);
  }

  async function handleRemove() {
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch("/api/v1/profile/banking", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_code: null,
          account_holder: null,
          account_number: null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setRemoveError(
          json?.error?.message ?? "Removal failed. Please try again.",
        );
        return;
      }
      setDisplay({
        bank_name: null,
        bank_code: null,
        bank_account_holder: null,
        bank_account_number_last4: null,
        bank_account_status: null,
        bank_account_rejection_reason: null,
      });
      setConfirmingRemove(false);
    } catch {
      setRemoveError("A network error occurred. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="card p-6">
      <h2 className="font-cinzel text-text-primary border-border mb-4 border-b pb-3 text-base font-semibold tracking-wider">
        Banking / Payouts
      </h2>

      {editing ? (
        <>
          <p className="font-lato text-text-muted mb-4 text-sm">
            Where prizes paid through MY Chess Tour are sent. Changing these
            details means they are verified again before the next prize. Only
            you can see them.
          </p>
          <BankingForm
            initial={display}
            onSaved={handleSaved}
            onCancel={() => setEditing(false)}
            submitLabel="Save banking details"
          />
        </>
      ) : hasDetails ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="border-border flex flex-col gap-0.5 border-b py-3">
              <span className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
                Bank Name
              </span>
              <span className="font-lato text-text-body text-sm">
                {display.bank_name || "—"}
              </span>
            </div>
            <div className="border-border flex flex-col gap-0.5 border-b py-3">
              <span className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
                Account Holder
              </span>
              <span className="font-lato text-text-body text-sm">
                {display.bank_account_holder || "—"}
              </span>
            </div>
            <div className="border-border flex flex-col gap-0.5 border-b py-3">
              <span className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
                Account Number
              </span>
              <span className="font-lato text-text-body text-sm">
                {display.bank_account_number_last4
                  ? `•••• ${display.bank_account_number_last4}`
                  : "—"}
              </span>
            </div>
            {statusCopy && (
              <div className="flex flex-col gap-0.5 py-3">
                <span className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
                  Verification
                </span>
                <span className={`font-lato text-sm ${statusCopy.className}`}>
                  {statusCopy.label}
                  {display.bank_account_status === "rejected" &&
                    display.bank_account_rejection_reason &&
                    ` — ${display.bank_account_rejection_reason}`}
                </span>
                <span className="font-lato text-text-muted text-xs">
                  {statusCopy.note}
                </span>
              </div>
            )}
          </div>
          {confirmingRemove ? (
            <div className="flex flex-col gap-3">
              <p className="font-lato text-text-secondary text-sm">
                This removes your bank details and withdraws your consent to us
                storing them. Prizes paid through MY Chess Tour can&apos;t be
                sent to you until you add them again. Records of prizes already
                paid are kept for 7 years, as the law requires.
              </p>
              {removeError && (
                <p className="font-lato text-sm text-red-400">{removeError}</p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="btn-secondary w-fit rounded-md"
                  onClick={() => {
                    setConfirmingRemove(false);
                    setRemoveError(null);
                  }}
                  disabled={removing}
                >
                  Keep my details
                </button>
                <button
                  type="button"
                  className="btn-primary w-fit rounded-md"
                  onClick={handleRemove}
                  disabled={removing}
                >
                  {removing ? "Removing…" : "Remove and withdraw consent"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                className="btn-secondary w-fit rounded-md"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
              <button
                type="button"
                className="font-lato text-text-muted hover:text-text-secondary w-fit text-sm underline"
                onClick={() => setConfirmingRemove(true)}
              >
                Remove bank details and withdraw consent
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-lato text-text-muted text-sm">
            Add your bank details so we can send you prizes paid through MY
            Chess Tour. Only you can see these details.
          </p>
          <button
            type="button"
            className="btn-primary w-fit rounded-md"
            onClick={() => setEditing(true)}
          >
            Add banking details
          </button>
        </div>
      )}
    </div>
  );
}
