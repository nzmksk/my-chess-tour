"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatRmExact, toTitleCase } from "@/app/tournaments/utils";

interface Props {
  tournamentSlug: string;
  feeTier: string;
  grossCents: number;
  checkoutUrl: string;
  /** When the seat hold lapses and the tier unlocks (ISO). */
  unlockAt: string;
}

function remainingMs(unlockAt: string): number {
  return Math.max(0, new Date(unlockAt).getTime() - Date.now());
}

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Shown on the register page when the user has a still-live pending payment.
 * Resuming reuses the *same* CHIP link (no timer reset), and the fee tier is
 * locked until the hold lapses — so we surface a "Continue payment" action
 * instead of the tier form. Once the countdown ends we refresh so the page
 * reverts to the normal form (the registration has expired and any tier is
 * selectable again).
 */
export default function PaymentInProgress({
  tournamentSlug,
  feeTier,
  grossCents,
  checkoutUrl,
  unlockAt,
}: Props) {
  const router = useRouter();
  const [left, setLeft] = useState(() => remainingMs(unlockAt));

  useEffect(() => {
    const id = setInterval(() => {
      const ms = remainingMs(unlockAt);
      setLeft(ms);
      if (ms <= 0) {
        clearInterval(id);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [unlockAt, router]);

  return (
    <div className="mx-auto max-w-lg">
      <div className="card card--featured flex flex-col p-8 text-center">
        <div className="confirm-icon">♟</div>
        <h2 className="confirm-title">Payment in Progress</h2>
        <p className="confirm-body">
          You have a payment in progress for this tournament. Continue with your
          existing payment link to confirm your spot.
        </p>
        <div className="session-info mt-2 text-left">
          <div className="session-row">
            <span className="session-key">Fee Tier</span>
            <span className="session-val">{toTitleCase(feeTier)}</span>
          </div>
          <div className="session-row">
            <span className="session-key">Total</span>
            <span className="session-val">
              {grossCents === 0 ? "Free" : formatRmExact(grossCents)}
            </span>
          </div>
          <div className="session-row">
            <span className="session-key">Tier locked for</span>
            <span className="session-val font-mono">
              {formatCountdown(left)}
            </span>
          </div>
        </div>
        <p className="confirm-body mt-2 text-xs">
          To choose a different fee tier, let this payment window expire — the
          page will refresh when the timer ends.
        </p>
        <a
          href={checkoutUrl}
          className="btn-primary mt-2 rounded-md text-center"
        >
          Continue Payment
        </a>
        <Link
          href={`/tournaments/${tournamentSlug}`}
          className="btn-secondary mt-4 rounded-md text-center"
        >
          Back to Tournament
        </Link>
      </div>
    </div>
  );
}
