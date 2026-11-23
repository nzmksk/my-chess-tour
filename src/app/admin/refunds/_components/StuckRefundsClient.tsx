"use client";

import { useState } from "react";
import Link from "next/link";
import { formatRinggit } from "@/services/payouts/format";
import { REFUND_STUCK_AFTER_MINUTES } from "@/lib/refunds/stuck-after";
import type { StuckRefund } from "@/services/refunds/stuck";
import RefireRefundButton, { type RefireResult } from "./RefireRefundButton";
import AdminBackLink from "@/app/admin/_components/AdminBackLink";

type StuckReason = "no_purchase" | "failed" | "never_sent" | "no_answer";

const REASONS: Record<
  StuckReason,
  { label: string; detail: string; className: string }
> = {
  no_purchase: {
    label: "No CHIP purchase",
    detail:
      "The registration payment has no CHIP purchase to refund against, so it can't be retried. Refund the player by hand.",
    className: "bg-danger/15 text-danger border border-danger/20",
  },
  failed: {
    label: "Failed",
    detail:
      "CHIP reported the refund failed. The player has been told and is still owed.",
    className: "bg-danger/15 text-danger border border-danger/20",
  },
  never_sent: {
    label: "Never sent",
    detail: "This refund was never sent to CHIP.",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  no_answer: {
    label: "No answer",
    detail:
      "Sent to CHIP, but nothing came back. The webhook may have been missed.",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
};

// Why this refund is stuck. Listing is refund_fire_due's call; this only
// labels it.
function stuckReason(r: StuckRefund): StuckReason {
  if (!r.original_chip_purchase_id) return "no_purchase";
  if (
    r.failed_at &&
    (!r.last_fired_at || Date.parse(r.failed_at) >= Date.parse(r.last_fired_at))
  ) {
    return "failed";
  }
  if (!r.last_fired_at) return "never_sent";
  return "no_answer";
}

// Admin-facing instants, read in Malaysian time so server and browser agree.
function formatInstant(iso: string): string {
  return `${new Date(iso).toLocaleString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  })} MYT`;
}

function ResultLine({ result }: { result: RefireResult }) {
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className={`font-lato text-xs ${result.ok ? "text-success" : "text-danger"}`}
    >
      {result.message}
    </p>
  );
}

function StuckRefundCard({
  refund,
  result,
  onResult,
}: {
  refund: StuckRefund;
  result: RefireResult | undefined;
  onResult: (result: RefireResult) => void;
}) {
  const reason = REASONS[stuckReason(refund)];
  return (
    <div className="card flex flex-col gap-2 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-lato text-text-primary text-sm font-semibold">
            {refund.payer_name ?? "Unknown payer"}
          </h3>
          {refund.payer_email && (
            <p className="font-lato text-text-muted mt-0.5 text-xs break-all">
              {refund.payer_email}
            </p>
          )}
          <p className="font-lato text-text-muted mt-0.5 text-xs">
            <Link
              href={`/admin/tournaments/${refund.tournament_id}`}
              className="hover:text-text-primary underline"
            >
              {refund.tournament_name}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-cinzel text-text-primary text-sm font-bold whitespace-nowrap">
            {formatRinggit(refund.amount_cents)}
          </span>
          <span
            className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest whitespace-nowrap uppercase ${reason.className}`}
          >
            {reason.label}
          </span>
        </div>
      </div>

      <p className="font-lato text-text-secondary text-xs">{reason.detail}</p>

      <dl className="font-lato text-text-muted grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt>Requested</dt>
        <dd>{formatInstant(refund.requested_at)}</dd>
        {refund.last_fired_at && (
          <>
            <dt>Last sent</dt>
            <dd>{formatInstant(refund.last_fired_at)}</dd>
          </>
        )}
        {refund.failed_at && (
          <>
            <dt>First failed</dt>
            <dd>{formatInstant(refund.failed_at)}</dd>
          </>
        )}
        {refund.original_chip_purchase_id && (
          <>
            <dt>CHIP purchase</dt>
            <dd className="break-all">{refund.original_chip_purchase_id}</dd>
          </>
        )}
      </dl>

      {refund.original_chip_purchase_id && (
        <RefireRefundButton refundId={refund.refund_id} onResult={onResult} />
      )}
      {result && <ResultLine result={result} />}
    </div>
  );
}

interface RetriedRefund extends RefireResult {
  label: string;
}

export default function StuckRefundsClient({
  refunds,
}: {
  refunds: StuckRefund[];
}) {
  // What each retry this visit came to, by refund id. Kept here because a
  // retry that works drops the refund (and its card) from the list.
  const [results, setResults] = useState<Record<string, RetriedRefund>>({});

  const owed = refunds.reduce((sum, r) => sum + r.amount_cents, 0);
  const listed = new Set(refunds.map((r) => r.refund_id));
  const cleared = Object.entries(results).filter(([id]) => !listed.has(id));

  function recordResult(refund: StuckRefund, result: RefireResult) {
    setResults((prev) => ({
      ...prev,
      [refund.refund_id]: {
        ...result,
        label: `${refund.payer_name ?? "Unknown payer"} · ${refund.tournament_name}`,
      },
    }));
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <AdminBackLink />
      <div className="mb-6">
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          Stuck refunds
        </h1>
        <p className="font-lato text-text-muted mt-1 text-sm">
          Refunds still owed to players that nothing is moving: never sent to
          CHIP, or sent more than {REFUND_STUCK_AFTER_MINUTES} minutes ago and
          either failed or got no answer. Nothing retries these on its own. Retrying checks
          the purchase at CHIP first, so a player is never refunded twice.
        </p>
      </div>

      {cleared.length > 0 && (
        <div className="mb-6">
          <h2 className="font-cinzel text-text-primary mb-3 text-base font-bold tracking-wide">
            Just retried
          </h2>
          <ul className="flex flex-col gap-2">
            {cleared.map(([id, r]) => (
              <li key={id} className="card flex flex-col gap-1 px-5 py-3">
                <span className="font-lato text-text-primary text-sm font-semibold">
                  {r.label}
                </span>
                <ResultLine result={r} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {refunds.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="mb-4 text-4xl opacity-20">♟</div>
          <p className="font-lato text-text-muted text-sm leading-relaxed">
            No stuck refunds. Every refund has cleared or is with CHIP.
          </p>
        </div>
      ) : (
        <>
          <p className="font-lato text-text-secondary mb-3 text-sm">
            {refunds.length} {refunds.length === 1 ? "refund" : "refunds"} ·{" "}
            {formatRinggit(owed)} owed
          </p>
          <div className="flex flex-col gap-3">
            {refunds.map((r) => (
              <StuckRefundCard
                key={r.refund_id}
                refund={r}
                result={results[r.refund_id]}
                onResult={(result) => recordResult(r, result)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
