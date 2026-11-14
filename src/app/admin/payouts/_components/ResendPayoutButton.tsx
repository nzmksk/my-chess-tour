"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// executePayout's result, after a re-send.
const OUTCOME_MESSAGES: Record<string, string> = {
  paid: "Paid.",
  sent: "Sent to CHIP. It will show as paid once CHIP confirms the transfer.",
  awaiting_budget:
    "Still waiting on CHIP Send budget. It goes out once a budget increase is approved and the balance lands.",
  blocked:
    "Still can't be sent: a cancellation or refund is in the way, or the recipient needs to fix their details.",
  failed: "The transfer failed. The reason is shown on the payout.",
  error: "Sending didn't go through this time. It is safe to try again.",
  skipped: "Nothing to send: the payout is already with CHIP or settled.",
};

/**
 * Re-runs the send of an approved payout that hasn't gone out. Safe to press
 * repeatedly: the server re-checks everything and CHIP dedupes on the payout id.
 */
export default function ResendPayoutButton({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resend() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/v1/admin/payouts/${payoutId}/send`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error?.message ?? "Failed to send the payout.");
        return;
      }
      setMessage(OUTCOME_MESSAGES[json.data?.outcome] ?? "Done.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={resend}
        disabled={isPending}
        className="font-lato bg-bg-base border-border text-text-primary hover:border-gold-dim rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Retry send"}
      </button>
      {message && (
        <p role="status" className="font-lato text-success text-xs">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="font-lato text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
