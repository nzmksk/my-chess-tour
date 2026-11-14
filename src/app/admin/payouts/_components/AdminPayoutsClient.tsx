"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatCalendarDate } from "@/lib/tournaments/datetime";
import { MIN_PAYOUT_CENTS } from "@/services/payouts/constants";
import type {
  AdminPayout,
  AdminPayoutCandidate,
  AdminPayoutQueue,
  PayoutStatus,
} from "@/services/payouts/admin-queue";
import ResendPayoutButton from "./ResendPayoutButton";

type TabKey = "all" | PayoutStatus;

const STATUS_CONFIG: Record<PayoutStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  processing: {
    label: "Processing",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  paid: {
    label: "Paid",
    className: "bg-success/10 text-success border border-success/20",
  },
  failed: {
    label: "Failed",
    className: "bg-danger/15 text-danger border border-danger/20",
  },
};

// What a just-triggered payout actually did, since "queued" isn't "paid".
const OUTCOME_MESSAGES: Record<string, string> = {
  paid: "Paid.",
  sent: "Sent to CHIP. It will show as paid once CHIP confirms the transfer.",
  awaiting_budget:
    "Queued, but the CHIP Send balance is too low. A budget request went to the approvers; the payout stays pending until it can be sent.",
  blocked: "Queued, but a cancellation or refund is in the way. It stays pending.",
  failed: "The payout failed. See the queue below for why.",
  skipped: "Queued, but not sent.",
  error: "Queued, but sending failed. Retry it from the payout in the list below.",
};

function formatCents(cents: number): string {
  return `RM ${(cents / 100).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// For instants. Calendar dates go through formatCalendarDate.
function formatInstant(iso: string): string {
  return new Date(iso).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function CandidateCard({ candidate }: { candidate: AdminPayoutCandidate }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = amount.trim();
  const cents = trimmed === "" ? null : Math.round(Number(trimmed) * 100);
  // Caught here so a mistyped amount never reaches the server. queue_payout
  // refuses the same amounts, so this is a convenience, not the guard.
  let amountError: string | null = null;
  if (cents !== null) {
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      amountError = "Enter an amount in ringgit, e.g. 50.00.";
    } else if (cents > candidate.available_cents) {
      amountError = `That is more than the ${formatCents(candidate.available_cents)} available to pay out.`;
    } else if (cents < MIN_PAYOUT_CENTS) {
      amountError = `The minimum payout is ${formatCents(MIN_PAYOUT_CENTS)}.`;
    }
  }
  const payingCents = cents ?? candidate.available_cents;

  function pay() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await fetch("/api/v1/admin/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournament_id: candidate.tournament_id,
          ...(cents === null ? {} : { amount_cents: cents }),
        }),
      });
      const json = await res.json().catch(() => ({}));
      setConfirming(false);
      if (!res.ok) {
        setError(json.error?.message ?? "Failed to create the payout.");
        return;
      }
      setMessage(OUTCOME_MESSAGES[json.data?.outcome] ?? "Queued.");
      router.refresh();
    });
  }

  return (
    <div className="card flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-lato text-text-primary text-sm font-semibold">
            {candidate.tournament_name}
          </h3>
          <p className="font-lato text-text-muted mt-0.5 text-xs">
            {candidate.organizer ?? "Unknown organizer"} · end date{" "}
            {formatCalendarDate(candidate.end_date)}
          </p>
          {candidate.is_beneficiary && (
            <p className="font-lato text-warning mt-1 text-xs">
              Paid to beneficiary: {candidate.recipient ?? "Unknown"}
            </p>
          )}
        </div>
        <p className="font-cinzel text-text-primary text-lg font-bold whitespace-nowrap">
          {formatCents(candidate.available_cents)}
        </p>
      </div>

      {candidate.blocked ? (
        <p className="font-lato text-warning text-xs">
          Can&apos;t be paid right now. {candidate.blocked}
        </p>
      ) : confirming ? (
        <div className="bg-bg-raised border-border rounded-lg border p-4">
          <p className="font-lato text-text-primary mb-3 text-sm">
            Send <strong>{formatCents(payingCents)}</strong> to{" "}
            <strong>{candidate.recipient ?? "the recipient"}</strong>? This moves
            real money and can&apos;t be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={isPending}
              className="font-lato bg-bg-base border-border text-text-primary hover:border-gold-dim rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={pay}
              disabled={isPending}
              className="btn-primary rounded-md disabled:opacity-50"
            >
              {isPending ? "Sending…" : "Confirm Payout"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label
              htmlFor={`amount-${candidate.tournament_id}`}
              className="font-lato text-text-muted text-xs"
            >
              Amount (RM)
            </label>
            <input
              id={`amount-${candidate.tournament_id}`}
              type="number"
              min={MIN_PAYOUT_CENTS / 100}
              max={candidate.available_cents / 100}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Full amount"
              aria-invalid={amountError !== null}
              aria-describedby={
                amountError
                  ? `amount-error-${candidate.tournament_id}`
                  : undefined
              }
              className="font-lato bg-bg-base border-border text-text-primary placeholder:text-text-muted focus:border-gold-bright w-36 rounded-lg border px-3 py-2 text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={amountError !== null}
              className="btn-primary rounded-md disabled:opacity-50"
            >
              Pay Out
            </button>
          </div>
          {amountError ? (
            <p
              id={`amount-error-${candidate.tournament_id}`}
              role="alert"
              className="font-lato text-danger text-right text-xs"
            >
              {amountError}
            </p>
          ) : (
            cents !== null && (
              <p className="font-lato text-warning text-right text-xs">
                A tournament gets one automatic payout, so paying part of it
                leaves the rest with no way to be paid.
              </p>
            )
          )}
        </div>
      )}

      {message && <p className="font-lato text-success text-xs">{message}</p>}
      {error && <p className="font-lato text-danger text-xs">{error}</p>}
    </div>
  );
}

// An early request waiting for review hasn't been queued to send, whatever its
// status says, so it gets its own label.
const AWAITING_REVIEW = {
  label: "Awaiting review",
  className: "bg-warning/15 text-warning border border-warning/20",
};
const REJECTED = {
  label: "Rejected",
  className: "bg-danger/15 text-danger border border-danger/20",
};

function PayoutCard({ payout }: { payout: AdminPayout }) {
  const status =
    payout.approval === "pending"
      ? AWAITING_REVIEW
      : payout.approval === "rejected"
        ? REJECTED
        : STATUS_CONFIG[payout.status];
  return (
    <div className="card flex flex-col gap-2 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-lato text-text-primary text-sm font-semibold">
            {payout.tournament?.name ?? "Unknown tournament"}
          </h3>
          <p className="font-lato text-text-muted mt-0.5 text-xs">
            {payout.organizer?.name ?? "Unknown organizer"} · {payout.kind} ·
            requested {formatInstant(payout.requested_at)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-cinzel text-text-primary text-sm font-bold whitespace-nowrap">
            {formatCents(payout.amount_cents)}
          </span>
          <span
            className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest whitespace-nowrap uppercase ${status.className}`}
          >
            {status.label}
          </span>
        </div>
      </div>

      <p className="font-lato text-text-secondary text-xs">
        To{" "}
        {payout.is_beneficiary ? (
          <span className="text-warning">
            beneficiary {payout.recipient?.name ?? "Unknown"}
          </span>
        ) : (
          (payout.recipient?.name ?? "Unknown")
        )}
        {payout.bank && (
          <>
            {" "}
            · {payout.bank.name} ending in {payout.bank.account_last4} (
            {payout.bank.status})
          </>
        )}
      </p>

      {payout.awaiting_budget && (
        <p className="font-lato text-warning text-xs">
          Waiting on a CHIP Send budget approval.
        </p>
      )}
      {payout.failure_reason && (
        <p className="font-lato text-danger text-xs">{payout.failure_reason}</p>
      )}
      {payout.receipt_url && (
        <a
          href={payout.receipt_url}
          target="_blank"
          rel="noreferrer"
          className="font-lato text-gold-bright text-xs hover:underline"
        >
          View CHIP receipt
        </a>
      )}
      {payout.can_resend && <ResendPayoutButton payoutId={payout.id} />}
      {payout.kind === "early" && (
        <Link
          href={`/admin/payouts/${payout.id}`}
          className="font-lato text-gold-bright text-xs hover:underline"
        >
          {payout.approval === "pending" ? "Review request →" : "View request"}
        </Link>
      )}
    </div>
  );
}

export default function AdminPayoutsClient({ data }: { data: AdminPayoutQueue }) {
  const { candidates, payouts } = data;
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  const tabs = useMemo(() => {
    const count = (status: PayoutStatus) =>
      payouts.filter((p) => p.status === status).length;
    return [
      { key: "all" as const, label: "All", count: payouts.length },
      { key: "pending" as const, label: "Pending", count: count("pending") },
      { key: "processing" as const, label: "Processing", count: count("processing") },
      { key: "paid" as const, label: "Paid", count: count("paid") },
      { key: "failed" as const, label: "Failed", count: count("failed") },
    ];
  }, [payouts]);

  const filtered = useMemo(
    () =>
      activeTab === "all"
        ? payouts
        : payouts.filter((p) => p.status === activeTab),
    [payouts, activeTab],
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          Payouts
        </h1>
        <p className="font-lato text-text-muted mt-1 text-sm">
          Pay out tournament revenue through CHIP Send, and follow what has been
          sent.
        </p>
      </div>

      <h2 className="font-cinzel text-text-primary mb-3 text-base font-bold tracking-wide">
        Ready to pay out
      </h2>
      {candidates.length === 0 ? (
        <p className="font-lato text-text-muted mb-8 text-sm">
          Nothing is payable right now.
        </p>
      ) : (
        <div className="mb-8 flex flex-col gap-3">
          {candidates.map((c) => (
            <CandidateCard key={c.tournament_id} candidate={c} />
          ))}
        </div>
      )}

      <h2 className="font-cinzel text-text-primary mb-3 text-base font-bold tracking-wide">
        Payouts
      </h2>
      <div className="border-border mb-5 flex gap-0 overflow-x-auto border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`font-lato border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? "text-text-primary border-gold-bright"
                : "text-text-muted hover:text-text-primary border-transparent"
            }`}
          >
            {tab.label}
            <span className="font-lato ml-1.5 text-xs">({tab.count})</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="mb-4 text-4xl opacity-20">♟</div>
          <p className="font-lato text-text-muted text-sm leading-relaxed">
            No payouts in this category.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((p) => (
            <PayoutCard key={p.id} payout={p} />
          ))}
        </div>
      )}
    </div>
  );
}
