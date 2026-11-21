"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  BankNameReview,
  BankNameReviews,
} from "@/services/payouts/name-review";

type Action = "confirm" | "reject";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NameRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <span className="font-lato text-text-muted w-44 shrink-0 text-xs tracking-wide uppercase">
        {label}
      </span>
      <span className="font-lato text-text-primary text-sm break-words">
        {children}
      </span>
    </div>
  );
}

function OwnerLink({ review }: { review: BankNameReview }) {
  if (review.owner === "organization") {
    return (
      <Link
        href={`/admin/applications/${review.owner_id}`}
        className="text-gold-bright hover:underline"
      >
        {review.owner_name}
      </Link>
    );
  }
  return <>{review.owner_name}</>;
}

function AccountDetails({ review }: { review: BankNameReview }) {
  return (
    <div className="flex flex-col gap-2">
      <NameRow
        label={review.owner === "organization" ? "Organization" : "Player"}
      >
        <OwnerLink review={review} />
        {!review.is_active && (
          <span className="text-warning"> (account since replaced)</span>
        )}
      </NameRow>
      <NameRow
        label={
          review.expected_is_registered_name
            ? "Registered name"
            : "Expected name"
        }
      >
        {review.expected_name}
      </NameRow>
      {review.expected_is_registered_name && (
        <NameRow label="Submitted holder">{review.account_holder}</NameRow>
      )}
      <NameRow label="Bank holder name">
        {review.bank_holder_name ?? (
          <span className="text-danger">Not returned by CHIP</span>
        )}
      </NameRow>
      <NameRow label="Account">
        {review.bank_name} •••• {review.account_number_last4}
      </NameRow>
    </div>
  );
}

function PendingCard({ review }: { review: BankNameReview }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function decide(action: Action) {
    if (!note.trim()) {
      setError(
        action === "confirm"
          ? "Say why this account can be paid despite the name."
          : "Give the owner a reason. It is emailed to them.",
      );
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/v1/admin/bank-accounts/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error?.message ?? `Failed to ${action}.`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="card flex flex-col gap-4 px-5 py-4">
      <AccountDetails review={review} />
      <p className="font-lato text-text-muted text-xs">
        Verified by CHIP on {formatDate(review.created_at)}. Not payable until
        you decide.
      </p>
      <div className="flex flex-col gap-2">
        <label
          htmlFor={`note-${review.id}`}
          className="font-lato text-text-secondary text-sm font-medium"
        >
          Note
        </label>
        <textarea
          id={`note-${review.id}`}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
          rows={2}
          maxLength={1000}
          placeholder="Confirming: why the names are the same person or entity. Rejecting: the reason the owner is emailed."
          className="font-lato bg-bg-raised border-border text-text-primary placeholder:text-text-muted focus:border-gold-bright w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
        />
        {error && <p className="font-lato text-danger text-xs">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => decide("reject")}
            disabled={isPending}
            className="font-lato bg-danger/10 text-danger border-danger/20 hover:bg-danger/20 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => decide("confirm")}
            disabled={isPending}
            className="font-lato bg-success/10 text-success border-success/20 hover:bg-success/20 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Confirm, same owner"}
          </button>
        </div>
      </div>
    </li>
  );
}

function DecidedCard({ review }: { review: BankNameReview }) {
  const confirmed = review.status === "verified";
  return (
    <li className="card flex flex-col gap-3 px-5 py-4">
      <AccountDetails review={review} />
      <p className="font-lato text-sm">
        <span className={confirmed ? "text-success" : "text-danger"}>
          {confirmed ? "Confirmed" : "Rejected"}
        </span>
        {review.name_reviewed_at && (
          <span className="text-text-muted">
            {" "}
            on {formatDate(review.name_reviewed_at)}
          </span>
        )}
        {review.name_review_note && (
          <span className="text-text-primary">
            {" "}
            — {review.name_review_note}
          </span>
        )}
      </p>
    </li>
  );
}

export default function BankNameReviewClient({
  reviews,
  loadFailed,
}: {
  reviews: BankNameReviews | null;
  loadFailed: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Link
          href="/admin/dashboard"
          className="font-lato text-text-muted hover:text-text-primary text-sm transition-colors"
        >
          ← Back
        </Link>
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          Bank Account Names
        </h1>
      </div>
      <p className="font-lato text-text-muted mb-6 text-sm">
        CHIP confirms a payout account exists and returns the holder name the
        bank has. These accounts are in a name that doesn&apos;t match who the
        money is for, so nothing is paid to them until you confirm or reject
        them.
      </p>

      {loadFailed || !reviews ? (
        <p className="font-lato text-danger text-sm">
          Couldn&apos;t load the accounts. Refresh to try again.
        </p>
      ) : (
        <>
          <h2 className="font-cinzel text-text-primary mb-3 text-base font-bold tracking-wide">
            Waiting for review ({reviews.pending.length})
          </h2>
          {reviews.pending.length === 0 ? (
            <p className="font-lato text-text-muted mb-8 text-sm">
              No accounts are waiting for a name review.
            </p>
          ) : (
            <ul className="mb-8 flex flex-col gap-3">
              {reviews.pending.map((r) => (
                <PendingCard key={r.id} review={r} />
              ))}
            </ul>
          )}

          {reviews.decided.length > 0 && (
            <>
              <h2 className="font-cinzel text-text-primary mb-3 text-base font-bold tracking-wide">
                Recently decided
              </h2>
              <ul className="flex flex-col gap-3">
                {reviews.decided.map((r) => (
                  <DecidedCard key={r.id} review={r} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
