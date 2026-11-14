"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatRinggit } from "@/services/payouts/format";
import type { PayoutReview } from "@/services/payouts/review";
import ResendPayoutButton from "../../_components/ResendPayoutButton";

const ENTITY_LABELS: Record<string, string> = {
  company: "Company (Sdn Bhd / Enterprise)",
  society: "Society / Association",
  individual: "Individual organizer",
};

const DOC_LABELS: Record<string, string> = {
  ssm: "SSM registration",
  ros: "ROS registration",
  authorization_letter: "Authorization letter",
  identity_document: "Identity document",
  other: "Other supporting document",
};

const BANK_STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting verification",
  verified: "Verified",
  rejected: "Rejected",
};

const APPROVAL_CONFIG: Record<
  PayoutReview["approval"],
  { label: string; className: string }
> = {
  pending: {
    label: "Awaiting review",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  approved: {
    label: "Approved",
    className: "bg-success/10 text-success border border-success/20",
  },
  rejected: {
    label: "Rejected",
    className: "bg-danger/15 text-danger border border-danger/20",
  },
};

const STATUS_LABELS: Record<PayoutReview["status"], string> = {
  pending: "Not sent yet",
  processing: "Being sent",
  paid: "Paid",
  failed: "Failed",
};

// executePayout's result, after an approval.
const OUTCOME_MESSAGES: Record<string, string> = {
  paid: "Approved and paid.",
  sent: "Approved and sent to CHIP. It will show as paid once CHIP confirms the transfer.",
  awaiting_budget:
    "Approved, but the CHIP Send balance is too low. A budget increase has been requested, and the payout goes out once it is approved.",
  blocked:
    "Approved, but something is in the way of sending it. Retry once it has cleared.",
  failed: "Approved, but the transfer failed. See the payouts list for why.",
  error: "Approved, but the transfer didn't go through. It is safe to retry.",
  skipped: "Approved.",
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const formatInstant = (iso: string) =>
  new Date(iso).toLocaleString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card mb-4 overflow-hidden">
      <div className="border-border bg-bg-raised border-b px-5 py-3">
        <h2 className="font-cinzel text-text-primary text-sm font-bold tracking-wide uppercase">
          {title}
        </h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border grid grid-cols-[150px_1fr] gap-x-4 gap-y-1 border-b py-2 last:border-0">
      <span className="font-lato text-text-muted pt-0.5 text-xs">{label}</span>
      <div className="font-lato text-text-primary text-sm">{children}</div>
    </div>
  );
}

function Sum({
  label,
  value,
  sign,
  strong,
  note,
}: {
  label: string;
  value: number;
  sign?: "−" | "×" | "=";
  strong?: boolean;
  note?: string;
}) {
  return (
    <div
      className={`grid grid-cols-[1.25rem_1fr_auto] items-baseline gap-x-2 py-1.5 ${
        sign === "=" ? "border-border border-t" : ""
      }`}
    >
      <span className="font-lato text-text-muted text-sm">{sign ?? ""}</span>
      <span className="font-lato text-text-secondary text-sm">
        {label}
        {note && <span className="text-text-muted block text-xs">{note}</span>}
      </span>
      <span
        className={`font-lato text-right text-sm tabular-nums ${
          strong ? "text-text-primary font-semibold" : "text-text-primary"
        }`}
      >
        {formatRinggit(value)}
      </span>
    </div>
  );
}

export default function PayoutReviewClient({ review }: { review: PayoutReview }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { cap, organization: org, tournament } = review;
  const remainingEarly = Math.max(0, cap.ceiling_cents - cap.early_committed_cents);
  const isPendingReview = review.approval === "pending";
  const approval = APPROVAL_CONFIG[review.approval];

  function submit(body: { action: "approve" | "reject"; rejection_reason?: string }) {
    setActionError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(`/api/v1/admin/payouts/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(
          json.error?.message ??
            (body.action === "approve"
              ? "Failed to approve the request."
              : "Failed to reject the request."),
        );
        return;
      }
      setShowRejectForm(false);
      setMessage(
        body.action === "approve"
          ? (OUTCOME_MESSAGES[json.data?.outcome] ?? "Approved.")
          : "Rejected. The organization has been told why.",
      );
      router.refresh();
    });
  }

  function handleReject() {
    if (!rejectionReason.trim()) {
      setActionError("Please provide a rejection reason.");
      return;
    }
    submit({ action: "reject", rejection_reason: rejectionReason.trim() });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href="/admin/payouts"
          className="font-lato text-text-muted hover:text-text-primary text-sm transition-colors"
        >
          ← Back
        </Link>
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          {review.kind === "early" ? "Early payout" : "Payout"}: {tournament.name}
        </h1>
        <span
          className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest whitespace-nowrap uppercase ${approval.className}`}
        >
          {approval.label}
        </span>
      </div>

      {/* Action bar */}
      {isPendingReview && (
        <div className="card mb-4 flex flex-col gap-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-lato text-text-muted text-sm">
              <strong className="text-text-primary">
                {formatRinggit(review.amount_cents)}
              </strong>{" "}
              requested {formatInstant(review.requested_at)}
              {review.requested_by && (
                <>
                  {" "}
                  by{" "}
                  <strong className="text-text-primary">{review.requested_by.name}</strong>
                </>
              )}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowRejectForm((v) => !v);
                  setActionError(null);
                }}
                disabled={isPending}
                className="font-lato bg-danger/10 text-danger border-danger/20 hover:bg-danger/20 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => submit({ action: "approve" })}
                disabled={isPending || review.approval_blocked !== null}
                className="font-lato bg-success/10 text-success border-success/20 hover:bg-success/20 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {isPending ? "Processing…" : "✓ Approve and pay"}
              </button>
            </div>
          </div>
          {review.approval_blocked && (
            <p role="alert" className="font-lato text-warning text-xs">
              Can&apos;t be approved right now: {review.approval_blocked} Reject it with
              a reason, or wait until that changes.
            </p>
          )}
        </div>
      )}

      {/* Rejection reason form */}
      {showRejectForm && isPendingReview && (
        <div className="bg-danger/10 border-danger/20 mb-4 rounded-lg border p-4">
          <label
            htmlFor="rejection-reason"
            className="font-lato text-danger mb-3 block text-sm font-semibold"
          >
            Rejection Reason
          </label>
          <textarea
            id="rejection-reason"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Explain why this request is being rejected. The organization is emailed this, and the request won't count towards their two."
            rows={3}
            className="font-lato bg-bg-raised border-border text-text-primary placeholder:text-text-muted focus:border-danger resize-vertical mb-3 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
          />
          {actionError && (
            <p className="font-lato text-danger mb-2 text-xs">{actionError}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowRejectForm(false);
                setActionError(null);
              }}
              disabled={isPending}
              className="font-lato bg-bg-raised border-border text-text-primary hover:border-gold-dim rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={isPending}
              className="font-lato bg-danger hover:bg-danger/80 rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            >
              {isPending ? "Processing…" : "Confirm Rejection"}
            </button>
          </div>
        </div>
      )}

      {actionError && !showRejectForm && (
        <p role="alert" className="font-lato text-danger mb-4 text-xs">
          {actionError}
        </p>
      )}
      {message && (
        <p role="status" className="font-lato text-success mb-4 text-sm">
          {message}
        </p>
      )}

      {review.can_resend && (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="font-lato text-text-muted text-sm">
            Approved, but not out with CHIP yet. Retrying re-checks everything first.
          </p>
          <ResendPayoutButton payoutId={review.id} />
        </div>
      )}

      {review.approval === "rejected" && review.rejection_reason && (
        <div className="bg-danger/10 border-danger/20 mb-4 rounded-lg border p-4">
          <p className="font-lato text-danger mb-1 text-xs font-semibold tracking-wide uppercase">
            Rejection Reason
          </p>
          <p className="font-lato text-text-primary text-sm">{review.rejection_reason}</p>
        </div>
      )}

      <Section title="Request">
        <DetailRow label="Amount">
          {formatRinggit(review.settled_amount_cents ?? review.amount_cents)}
        </DetailRow>
        {review.request_seq !== null && (
          <DetailRow label="Request">{review.request_seq} of 2</DetailRow>
        )}
        <DetailRow label="Reason">
          {review.reason ? (
            <span className="whitespace-pre-wrap">{review.reason}</span>
          ) : (
            <span className="text-text-muted">—</span>
          )}
        </DetailRow>
        <DetailRow label="Requested">
          {formatInstant(review.requested_at)}
          {review.requested_by && (
            <span className="text-text-muted">
              {" "}
              by {review.requested_by.name} ({review.requested_by.email})
            </span>
          )}
        </DetailRow>
        {review.reviewed_at && (
          <DetailRow label="Reviewed">
            {formatInstant(review.reviewed_at)}
            {review.reviewed_by && (
              <span className="text-text-muted"> by {review.reviewed_by.name}</span>
            )}
          </DetailRow>
        )}
        <DetailRow label="Transfer">
          {STATUS_LABELS[review.status]}
          {review.failure_reason && (
            <span className="text-danger"> — {review.failure_reason}</span>
          )}
        </DetailRow>
        <DetailRow label="Tournament">
          {tournament.name}{" "}
          <span className="text-text-muted">
            ({formatDate(tournament.start_date)} – {formatDate(tournament.end_date)})
          </span>
        </DetailRow>
        <DetailRow label="Registration closed">
          {tournament.registration_closed_at ? (
            formatInstant(tournament.registration_closed_at)
          ) : (
            <span className="text-warning">Not yet</span>
          )}
        </DetailRow>
      </Section>

      <Section title="How much can be paid early">
        <p className="font-lato text-text-muted mb-3 text-xs">
          Up to {cap.max_pct}% of the tournament&apos;s net revenue can be paid
          before it ends, and never more than is still available. These figures
          leave out this request itself.
        </p>
        <Sum label="Net revenue" note="Registrations net of fees and refunds" value={cap.net_revenue_cents} />
        <Sum sign="×" label={`${cap.max_pct}% early payout ceiling`} value={cap.ceiling_cents} />
        <Sum sign="−" label="Other early payouts, paid or in flight" value={cap.early_committed_cents} />
        <Sum sign="=" label="Left within the ceiling" value={remainingEarly} />
        <div className="mt-3" />
        <Sum label="Net revenue" value={cap.net_revenue_cents} />
        <Sum sign="−" label="Payouts already made" value={cap.paid_payouts_cents} />
        <Sum
          sign="−"
          label="Other payouts in flight"
          value={Math.max(0, cap.net_revenue_cents - cap.paid_payouts_cents - cap.available_cents)}
        />
        <Sum sign="=" label="Available to pay out" value={cap.available_cents} />
        <div className="border-border mt-3 border-t pt-3">
          <Sum
            label="Most that can be paid early (the lesser of the two)"
            value={cap.cap_cents}
            strong
          />
          {isPendingReview && (
            <p
              className={`font-lato mt-1 text-xs ${
                review.amount_cents > cap.cap_cents ? "text-danger" : "text-success"
              }`}
            >
              This request is for {formatRinggit(review.amount_cents)}
              {review.amount_cents > cap.cap_cents ? ", which is over the cap." : ", within the cap."}
            </p>
          )}
        </div>
        {cap.live_refund_cents > 0 && (
          <p className="font-lato text-warning mt-3 text-xs">
            {formatRinggit(cap.live_refund_cents)} of player refunds have not
            settled yet. No early payout can be approved until they do.
          </p>
        )}
      </Section>

      <Section title="Recipient">
        <DetailRow label="Organization">
          {org.name}{" "}
          <span className="text-text-muted">({org.approval_status})</span>
        </DetailRow>
        <DetailRow label="Entity Type">
          {org.entity_type ? (
            (ENTITY_LABELS[org.entity_type] ?? org.entity_type)
          ) : (
            <span className="text-danger">Not set</span>
          )}
        </DetailRow>
        <DetailRow label="Registration No.">
          {org.registration_number ?? <span className="text-text-muted">—</span>}
        </DetailRow>
        <DetailRow label="Agreement">
          {org.agreement_version ?? "Not accepted"}
          {org.agreement_accepted_at && (
            <span className="text-text-muted">
              {" "}
              (accepted {formatDate(org.agreement_accepted_at)})
            </span>
          )}
          {!org.agreement_current && (
            <span className="text-danger"> — not the current version</span>
          )}
        </DetailRow>
        {review.bank_account ? (
          <>
            <DetailRow label="Bank">{review.bank_account.bank_name}</DetailRow>
            <DetailRow label="Account Holder">{review.bank_account.account_holder}</DetailRow>
            {/* Last 4 only. No surface ever renders or returns the full number. */}
            <DetailRow label="Account Number">
              •••• {review.bank_account.account_number_last4}
            </DetailRow>
            <DetailRow label="Verification">
              <span
                className={
                  review.bank_account.status === "verified" ? "text-success" : "text-danger"
                }
              >
                {BANK_STATUS_LABELS[review.bank_account.status] ?? review.bank_account.status}
              </span>
              {!review.bank_account.is_active && (
                <span className="text-warning"> — since replaced</span>
              )}
            </DetailRow>
          </>
        ) : (
          <DetailRow label="Bank">
            <span className="text-danger">No active bank account on file</span>
          </DetailRow>
        )}
      </Section>

      <Section title="Verification Documents">
        {review.documents.length === 0 ? (
          <p className="font-lato text-text-muted text-sm">No documents on file.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {review.documents.map((doc) => (
              <span key={doc.id} className="font-lato text-sm">
                <span className="text-text-muted">
                  {DOC_LABELS[doc.doc_type] ?? doc.doc_type}:
                </span>{" "}
                {doc.url ? (
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gold-bright break-all hover:underline"
                  >
                    {doc.original_filename ?? "View document"}
                  </a>
                ) : (
                  <span className="text-danger">
                    {doc.original_filename ?? "Document"} — link unavailable
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
        <p className="font-lato text-text-muted mt-3 text-xs">
          Document links expire 5 minutes after this page was loaded. Reload to
          get fresh ones.
        </p>
      </Section>
    </div>
  );
}
