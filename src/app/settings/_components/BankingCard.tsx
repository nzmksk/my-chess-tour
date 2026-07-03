"use client";

import { useState } from "react";
import BankingForm, { type BankingDisplay } from "@/components/BankingForm";

interface Props {
  bankName: string | null;
  accountHolder: string | null;
  accountNumberLast4: string | null;
}

// Banking / payout details card. Kept outside the main profile edit form because
// these fields are freely editable (not set-once) and sensitive: the account
// number is masked on display and re-entered in full to change. Mirrors the
// self-contained OkuVerificationCard shape.
export default function BankingCard({
  bankName: initialBankName,
  accountHolder: initialAccountHolder,
  accountNumberLast4: initialLast4,
}: Props) {
  const [display, setDisplay] = useState<BankingDisplay>({
    bank_name: initialBankName,
    bank_account_holder: initialAccountHolder,
    bank_account_number_last4: initialLast4,
  });
  const [editing, setEditing] = useState(false);

  const hasDetails = Boolean(
    display.bank_name ||
    display.bank_account_holder ||
    display.bank_account_number_last4,
  );

  function handleSaved(masked: BankingDisplay) {
    setDisplay(masked);
    setEditing(false);
  }

  return (
    <div className="card p-6">
      <h2 className="font-cinzel text-text-primary border-border mb-4 border-b pb-3 text-base font-semibold tracking-wider">
        Banking / Payouts
      </h2>

      {editing ? (
        <>
          <p className="font-lato text-text-muted mb-4 text-sm">
            Used to pay out prize winnings and process refunds. Only you can see
            these details.
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
            <div className="flex flex-col gap-0.5 py-3">
              <span className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
                Account Number
              </span>
              <span className="font-lato text-text-body text-sm">
                {display.bank_account_number_last4
                  ? `•••• ${display.bank_account_number_last4}`
                  : "—"}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary w-fit rounded-md"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-lato text-text-muted text-sm">
            Add your bank details so we can pay out prize winnings and process
            refunds. Only you can see these details.
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
