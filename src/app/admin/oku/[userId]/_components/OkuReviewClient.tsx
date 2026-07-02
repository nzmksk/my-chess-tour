"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { OkuReview, OkuReviewStatus } from "../page";

const STATUS_CONFIG: Record<
  OkuReviewStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  verified: {
    label: "Verified",
    className: "bg-success/10 text-success border border-success/20",
  },
  rejected: {
    label: "Rejected",
    className: "bg-danger/15 text-danger border border-danger/20",
  },
};

interface Props {
  review: OkuReview;
}

export default function OkuReviewClient({ review }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const submitted = new Date(review.submitted_at).toLocaleString("en-MY", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  function submitReview(action: "approve" | "reject", reason?: string) {
    setActionError(null);
    startTransition(async () => {
      const res = await fetch(`/api/v1/admin/oku/${review.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "reject"
            ? { action, rejection_reason: reason }
            : { action },
        ),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setActionError(json.error?.message ?? `Failed to ${action}.`);
        return;
      }
      router.push("/admin/oku");
      router.refresh();
    });
  }

  function handleReject() {
    if (!rejectionReason.trim()) {
      setActionError("Please provide a rejection reason.");
      return;
    }
    submitReview("reject", rejectionReason.trim());
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href="/admin/oku"
          className="font-lato text-text-muted hover:text-text-primary text-sm transition-colors"
        >
          ← Back
        </Link>
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          {review.name || review.email || "OKU Submission"}
        </h1>
        <span
          className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest uppercase ${STATUS_CONFIG[review.oku_status].className}`}
        >
          {STATUS_CONFIG[review.oku_status].label}
        </span>
      </div>

      {/* Action bar */}
      {review.oku_status === "pending" && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="font-lato text-text-muted text-sm">
            Submitted on {submitted}
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
              onClick={() => submitReview("approve")}
              disabled={isPending}
              className="font-lato bg-success/10 text-success border-success/20 hover:bg-success/20 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {isPending ? "Processing…" : "✓ Approve"}
            </button>
          </div>
        </div>
      )}

      {showRejectForm && review.oku_status === "pending" && (
        <div className="bg-danger/10 border-danger/20 mb-4 rounded-lg border p-4">
          <p className="font-lato text-danger mb-3 text-sm font-semibold">
            Rejection Reason
          </p>
          <textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Explain why this OKU submission is being rejected. This is shown to the player."
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
              className="font-lato bg-danger rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-80 disabled:opacity-50"
            >
              {isPending ? "Processing…" : "Confirm Rejection"}
            </button>
          </div>
        </div>
      )}

      {actionError && !showRejectForm && (
        <p className="font-lato text-danger mb-4 text-xs">{actionError}</p>
      )}

      {review.oku_status === "rejected" && review.oku_rejection_reason && (
        <div className="bg-danger/10 border-danger/20 mb-4 rounded-lg border p-4">
          <p className="font-lato text-danger mb-1 text-xs font-semibold tracking-wide uppercase">
            Rejection Reason
          </p>
          <p className="font-lato text-text-primary text-sm">
            {review.oku_rejection_reason}
          </p>
        </div>
      )}

      {/* Applicant + document */}
      <section className="card mb-4 overflow-hidden">
        <div className="border-border bg-bg-raised border-b px-5 py-3">
          <h2 className="font-cinzel text-text-primary text-sm font-bold tracking-wide uppercase">
            Player
          </h2>
        </div>
        <div className="px-5 py-4">
          <p className="font-lato text-text-primary text-sm">{review.name}</p>
          <p className="font-lato text-text-muted text-sm">{review.email}</p>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-border bg-bg-raised border-b px-5 py-3">
          <h2 className="font-cinzel text-text-primary text-sm font-bold tracking-wide uppercase">
            Uploaded OKU Card
          </h2>
        </div>
        <div className="px-5 py-4">
          {review.document_url ? (
            <div className="flex flex-col gap-3">
              <div className="border-border relative h-80 w-full overflow-hidden rounded-md border">
                <Image
                  src={review.document_url}
                  alt="OKU card"
                  fill
                  unoptimized
                  className="object-contain"
                />
              </div>
              <a
                href={review.document_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gold-bright font-lato text-sm hover:underline"
              >
                Open in new tab (PDFs / full size) →
              </a>
            </div>
          ) : (
            <p className="font-lato text-text-muted text-sm">
              No document available.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
