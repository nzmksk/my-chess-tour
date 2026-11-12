"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EARLY_PAYOUT_MAX_PCT, MIN_PAYOUT_CENTS } from "@/services/payouts/constants";
import { formatRinggit } from "@/services/payouts/format";

const MAX_REASON_LENGTH = 1000;

/**
 * The early payout panel on a tournament's payout card: how much could be asked
 * for now and, for an owner, the form to ask. The amount checks here are a
 * convenience so a typo never reaches the server; request_early_payout is the
 * guard.
 */
export default function EarlyPayoutRequest({
  orgId,
  tournamentId,
  capCents,
  requestsUsed,
  blocked,
  canRequest,
}: {
  orgId: string;
  tournamentId: string;
  capCents: number;
  requestsUsed: number;
  /** Why nothing can be requested now, in words; null when something can. */
  blocked: string | null;
  canRequest: boolean;
}) {
  const router = useRouter();
  const ids = useId();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const trimmed = amount.trim();
  const cents = trimmed === "" ? null : Math.round(Number(trimmed) * 100);
  let amountError: string | null = null;
  if (cents !== null) {
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      amountError = "Enter an amount in ringgit, e.g. 500.00.";
    } else if (cents > capCents) {
      amountError = `That is more than the ${formatRinggit(capCents)} that can be paid early.`;
    } else if (cents < MIN_PAYOUT_CENTS) {
      amountError = `The minimum payout is ${formatRinggit(MIN_PAYOUT_CENTS)}.`;
    }
  }
  const canSubmit =
    cents !== null && amountError === null && reason.trim() !== "" && !isPending;

  function submit() {
    if (!canSubmit || cents === null) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/v1/organizations/${orgId}/payouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournament_id: tournamentId,
          amount_cents: cents,
          reason: reason.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error?.message ?? "Failed to request the early payout.");
        return;
      }
      setOpen(false);
      setAmount("");
      setReason("");
      setMessage(
        "Requested. A platform admin will review it, and you'll get an email with the decision.",
      );
      router.refresh();
    });
  }

  return (
    <div className="border-border flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-lato text-text-secondary text-xs">
          Early payout · {requestsUsed} of 2 used
          {blocked === null && (
            <>
              {" "}
              · up to{" "}
              <strong className="text-text-primary">{formatRinggit(capCents)}</strong> now
            </>
          )}
        </p>
        {canRequest && blocked === null && !open && (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setMessage(null);
            }}
            className="font-lato text-gold-bright text-xs font-semibold hover:underline"
          >
            Request early payout
          </button>
        )}
      </div>

      {blocked !== null && (
        <p className="font-lato text-text-muted text-xs">{blocked}</p>
      )}
      {blocked === null && !canRequest && (
        <p className="font-lato text-text-muted text-xs">
          An organization owner can request it.
        </p>
      )}

      {open && (
        <div className="flex flex-col gap-2">
          <p className="font-lato text-text-muted text-xs">
            Up to {EARLY_PAYOUT_MAX_PCT}% of net revenue can be paid before the
            tournament ends, twice at most. A platform admin reviews each
            request. The rest is paid automatically after the tournament.
          </p>
          <label htmlFor={`${ids}-amount`} className="font-lato text-text-secondary text-xs">
            Amount (RM)
          </label>
          <input
            id={`${ids}-amount`}
            type="number"
            inputMode="decimal"
            min={MIN_PAYOUT_CENTS / 100}
            max={capCents / 100}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={(capCents / 100).toFixed(2)}
            aria-invalid={amountError !== null}
            aria-describedby={amountError ? `${ids}-amount-error` : undefined}
            className="font-lato bg-bg-base border-border text-text-primary placeholder:text-text-muted focus:border-gold-bright w-40 rounded-lg border px-3 py-2 text-sm focus:outline-none"
          />
          {amountError && (
            <p id={`${ids}-amount-error`} role="alert" className="font-lato text-danger text-xs">
              {amountError}
            </p>
          )}
          <label htmlFor={`${ids}-reason`} className="font-lato text-text-secondary text-xs">
            What is it for?
          </label>
          <textarea
            id={`${ids}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX_REASON_LENGTH}
            rows={2}
            placeholder="e.g. Venue deposit due before the event"
            className="font-lato bg-bg-base border-border text-text-primary placeholder:text-text-muted focus:border-gold-bright resize-vertical rounded-lg border px-3 py-2 text-sm focus:outline-none"
          />
          {error && (
            <p role="alert" className="font-lato text-danger text-xs">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={isPending}
              className="font-lato bg-bg-raised border-border text-text-primary hover:border-gold-dim rounded-md border px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="btn-primary rounded-md text-xs disabled:opacity-50"
            >
              {isPending ? "Requesting…" : "Send request"}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="font-lato text-success text-xs">
          {message}
        </p>
      )}
    </div>
  );
}
