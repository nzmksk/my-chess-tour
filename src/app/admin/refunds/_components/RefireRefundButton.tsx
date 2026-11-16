"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { REFUND_STUCK_AFTER_MINUTES } from "@/lib/refunds/stuck-after";

export interface RefireResult {
  ok: boolean;
  message: string;
}

// fireRefund's outcome, after a re-fire. `ok` decides the colour.
const OUTCOMES: Record<string, RefireResult> = {
  refunded: { ok: true, message: "Refunded. The player has been emailed." },
  reconciled: {
    ok: true,
    message:
      "CHIP had already refunded this purchase. It is now recorded as refunded and the player has been emailed.",
  },
  processing: {
    ok: true,
    message: "CHIP is processing the refund. It will clear once CHIP confirms it.",
  },
  settled: { ok: true, message: "Already refunded. Nothing to do." },
  in_flight: {
    ok: false,
    message: `This refund was sent to CHIP in the last ${REFUND_STUCK_AFTER_MINUTES} minutes. Give it time to come back before retrying.`,
  },
  failed: {
    ok: false,
    message: "CHIP refused the refund. Check the purchase in the CHIP dashboard.",
  },
  error: {
    ok: false,
    message: `The retry didn't go through. It is safe to try again in ${REFUND_STUCK_AFTER_MINUTES} minutes.`,
  },
  needs_attention: {
    ok: false,
    message:
      "CHIP shows this purchase as partly refunded. Resolve it in the CHIP dashboard; it hasn't been retried.",
  },
  no_purchase: {
    ok: false,
    message:
      "There is no CHIP purchase to refund against. This one needs to be handled by hand.",
  },
  rejected: { ok: false, message: "This refund was rejected and isn't owed." },
};

/**
 * Fires a stuck refund again. Safe to press repeatedly: the server refuses a
 * refund whose money already moved or that was just sent, and checks the
 * purchase at CHIP before refunding so it never refunds twice.
 *
 * The result goes up to the page rather than staying here: a retry that works
 * takes the refund off the stuck list on refresh, and this button with it.
 */
export default function RefireRefundButton({
  refundId,
  onResult,
}: {
  refundId: string;
  onResult: (result: RefireResult) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function refire() {
    startTransition(async () => {
      const res = await fetch(`/api/v1/admin/refunds/${refundId}/refire`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        onResult({
          ok: false,
          message: json.error?.message ?? "Failed to retry the refund.",
        });
        return;
      }
      onResult(OUTCOMES[json.data?.outcome] ?? { ok: true, message: "Done." });
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={refire}
      disabled={isPending}
      className="font-lato bg-bg-base border-border text-text-primary hover:border-gold-dim self-start rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
    >
      {isPending ? "Retrying…" : "Retry refund"}
    </button>
  );
}
