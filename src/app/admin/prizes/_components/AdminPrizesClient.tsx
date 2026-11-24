"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BankHolderNameCheck from "@/components/BankHolderNameCheck";
import { formatRinggit } from "@/services/payouts/format";
import { prizeAwardStateLabel } from "@/services/prizes/problems";
import type { PrizeAwardView } from "@/services/prizes/awards";
import AdminBackLink from "@/app/admin/_components/AdminBackLink";

// The admin prize queue (#523). An award is checked here before any money moves:
// a wrong name is an irreversible transfer. Approving runs the funding and pool
// guards in the database and then sends the prize.

const STATE_CLASS: Record<string, string> = {
  "Awaiting review": "bg-warning/15 text-warning border border-warning/20",
  Approved: "bg-warning/15 text-warning border border-warning/20",
  Sending: "bg-warning/15 text-warning border border-warning/20",
  Paid: "bg-success/10 text-success border border-success/20",
  Failed: "bg-danger/15 text-danger border border-danger/20",
  Rejected: "bg-danger/15 text-danger border border-danger/20",
};

const OUTCOME_MESSAGES: Record<string, string> = {
  paid: "Approved and paid.",
  sent: "Approved and sent to CHIP. It shows as paid once CHIP confirms the transfer.",
  awaiting_budget:
    "Approved, but the CHIP Send balance is too low. A budget request went to the approvers.",
  blocked:
    "Approved. It goes out once the winner has a verified bank account; they have been emailed.",
  failed: "Approved, but the transfer failed. The organizer can enter the winner again.",
  skipped: "Approved, but not sent.",
  error: "Approved, but sending failed. Use Retry send.",
};

const RETRY_MESSAGES: Record<string, string> = {
  paid: "Paid.",
  sent: "Sent to CHIP. It shows as paid once CHIP confirms the transfer.",
  awaiting_budget: "Still waiting on CHIP Send budget.",
  blocked: "Still waiting: the winner has no verified bank account, or the tournament is under review.",
  failed: "The transfer failed. The organizer can enter the winner again.",
  skipped: "Nothing to send: it is already with CHIP or settled.",
  error: "Sending failed again. Try later; the daily run retries it too.",
};

const BANK_LABEL: Record<string, string> = {
  verified: "Verified account",
  pending: "Account not yet verified",
  rejected: "Account rejected",
  name_mismatch: "Account holder name doesn't match: waiting for review",
};

function formatInstant(iso: string): string {
  return new Date(iso).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function AwardCard({ award }: { award: PrizeAwardView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = prizeAwardStateLabel(award);
  const canReview = award.approval === "pending";
  const canRetry =
    award.approval === "approved" && !award.processed_at && award.status === "pending";

  function call(url: string, init: RequestInit, onDone: (data: { outcome?: string }) => void) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await fetch(url, init);
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setError(json?.error?.message ?? "Something went wrong. Please try again.");
          return;
        }
        onDone(json?.data ?? {});
        router.refresh();
      } catch {
        setError("A network error occurred. Please try again.");
      }
    });
  }

  const review = (action: "approve" | "reject") =>
    call(
      `/api/v1/admin/prize-awards/${award.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "reject" ? { action, rejection_reason: reason.trim() } : { action },
        ),
      },
      (data) =>
        setMessage(
          action === "reject"
            ? "Rejected. The organizer can enter the right winner."
            : (OUTCOME_MESSAGES[data.outcome ?? ""] ?? "Approved."),
        ),
    );

  const retry = () =>
    call(`/api/v1/admin/prize-awards/${award.id}/send`, { method: "POST" }, (data) =>
      setMessage(RETRY_MESSAGES[data.outcome ?? ""] ?? "Retried."),
    );

  return (
    <div className="card flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-cinzel text-text-primary text-sm font-bold">
            {award.winner_name}
          </p>
          <p className="font-lato text-text-secondary text-sm">
            {award.category}
            {award.place ? ` — ${award.place}` : ""} · {formatRinggit(award.amount_cents)}
          </p>
          <p className="font-lato text-text-muted text-xs">
            <Link href={`/admin/tournaments/${award.tournament_id}`} className="hover:text-text-primary underline">
              {award.tournament_name ?? "Tournament"}
            </Link>
            {award.organization_name ? ` · ${award.organization_name}` : ""} · entered{" "}
            {formatInstant(award.entered_at)}
            {award.payee_reason === "guardian_of_minor" && " · Paid to a guardian (minor)"}
            {award.winner_bank_status
              ? ` · ${BANK_LABEL[award.winner_bank_status]}`
              : " · No bank account"}
          </p>
          {award.winner_bank_name_check && (
            <p className="font-lato text-text-muted text-xs">
              Bank&apos;s holder name:{" "}
              <BankHolderNameCheck
                bankHolderName={award.winner_bank_holder_name ?? null}
                check={award.winner_bank_name_check}
                underReview={award.winner_bank_status === "name_mismatch"}
              />
            </p>
          )}
        </div>
        <span
          className={`font-cinzel rounded-md px-2 py-0.5 text-xs font-bold tracking-widest uppercase ${STATE_CLASS[state] ?? ""}`}
        >
          {state}
        </span>
      </div>

      {award.rejection_reason && (
        <p className="font-lato text-text-muted text-xs">Rejected: {award.rejection_reason}</p>
      )}
      {award.status === "failed" && award.failure_reason && (
        <p className="font-lato text-danger text-xs">Failed: {award.failure_reason}</p>
      )}
      {award.status === "paid" && award.chip_receipt_url && (
        <a
          href={award.chip_receipt_url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-lato text-gold-bright text-xs underline"
        >
          CHIP receipt
        </a>
      )}

      {canReview && !rejecting && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary rounded-md px-4 py-2 text-xs"
            disabled={isPending}
            onClick={() => review("approve")}
          >
            {isPending ? "Working…" : "Approve and send"}
          </button>
          <button
            type="button"
            className="btn-secondary rounded-md px-4 py-2 text-xs"
            disabled={isPending}
            onClick={() => setRejecting(true)}
          >
            Reject
          </button>
        </div>
      )}
      {canReview && rejecting && (
        <div className="flex flex-col gap-2">
          <label className="input-label" htmlFor={`reject-${award.id}`}>
            Reason (shown to the organizer)
          </label>
          <input
            id={`reject-${award.id}`}
            className="input text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isPending}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary rounded-md px-4 py-2 text-xs"
              disabled={isPending || !reason.trim()}
              onClick={() => review("reject")}
            >
              Confirm rejection
            </button>
            <button
              type="button"
              className="btn-secondary rounded-md px-4 py-2 text-xs"
              disabled={isPending}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {canRetry && (
        <button
          type="button"
          className="btn-secondary w-fit rounded-md px-4 py-2 text-xs"
          disabled={isPending}
          onClick={retry}
        >
          {isPending ? "Working…" : "Retry send"}
        </button>
      )}

      {message && <p className="font-lato text-success text-xs">{message}</p>}
      {error && <p className="font-lato text-danger text-xs">{error}</p>}
    </div>
  );
}

export default function AdminPrizesClient({ awards }: { awards: PrizeAwardView[] }) {
  const toReview = awards.filter((a) => a.approval === "pending");
  const inFlight = awards.filter((a) => a.approval === "approved" && !a.processed_at);
  const settled = awards.filter((a) => a.approval === "rejected" || a.processed_at);

  const sections: Array<{ title: string; note: string; rows: PrizeAwardView[] }> = [
    {
      title: `To Review (${toReview.length})`,
      note: "Check each winner against the arbiter's certified results. Approving commits pool money and sends the prize.",
      rows: toReview,
    },
    {
      title: `Approved, Not Yet Paid (${inFlight.length})`,
      note: "Waiting on the winner's bank account, CHIP Send budget, or CHIP itself. The daily run retries these.",
      rows: inFlight,
    },
    {
      title: "Recently Settled",
      note: "Paid, failed and rejected awards.",
      rows: settled,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <AdminBackLink />
      <h1 className="font-cinzel text-text-primary mb-1 text-2xl font-bold tracking-wide">
        Prizes
      </h1>
      <p className="font-lato text-text-muted mb-8 text-sm">
        Prize money MY Chess Tour distributes from sponsor-funded pools. It is held apart from
        organizer revenue and never paid beyond what was collected.
      </p>

      {sections.map((section) => (
        <div key={section.title} className="mb-8">
          <h2 className="font-cinzel text-text-primary mb-1 text-base font-bold tracking-wide">
            {section.title}
          </h2>
          <p className="font-lato text-text-muted mb-3 text-xs">{section.note}</p>
          {section.rows.length === 0 ? (
            <div className="card px-5 py-6 text-center">
              <p className="font-lato text-text-muted text-sm">Nothing here.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {section.rows.map((award) => (
                <AwardCard key={award.id} award={award} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
