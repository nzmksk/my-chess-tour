"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  CancellationRequest,
  CancellationCounts,
  RequestStatus,
} from "../page";
import { formatCalendarDate } from "@/lib/datetime";

type TabKey = "all" | RequestStatus;

interface Props {
  data: {
    counts: CancellationCounts;
    requests: CancellationRequest[];
  };
}

const STATUS_CONFIG: Record<
  RequestStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  approved: {
    label: "Approved",
    className: "bg-danger/15 text-danger border border-danger/20",
  },
  rejected: {
    label: "Rejected",
    className: "bg-bg-raised text-text-muted border border-border",
  },
};

function StatusBadge({ status }: { status: RequestStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest whitespace-nowrap uppercase ${config.className}`}
    >
      {config.label}
    </span>
  );
}

// For instants (a request's created_at). Calendar dates go through
// formatCalendarDate, which reads them from their own parts.
function formatInstant(iso: string): string {
  return new Date(iso).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function RequestCard({ req }: { req: CancellationRequest }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const requester = req.requester
    ? `${req.requester.first_name} ${req.requester.last_name}`
    : "Unknown organizer";

  async function submit(
    action: "approve" | "reject",
    reason?: string,
  ): Promise<void> {
    setActionError(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/v1/admin/tournament-cancellations/${req.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "reject"
              ? { action, rejection_reason: reason }
              : { action },
          ),
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setActionError(json.error?.message ?? "Failed to process request.");
        return;
      }
      router.refresh();
    });
  }

  function handleReject() {
    if (!rejectionReason.trim()) {
      setActionError("Please provide a reason for rejecting this request.");
      return;
    }
    void submit("reject", rejectionReason.trim());
  }

  return (
    <div className="card flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-lato text-text-primary text-sm font-semibold">
            {req.tournament ? (
              req.tournament.slug ? (
                <Link
                  href={`/tournaments/${req.tournament.slug}`}
                  className="hover:text-gold-bright transition-colors"
                >
                  {req.tournament.name}
                </Link>
              ) : (
                req.tournament.name
              )
            ) : (
              "Unknown tournament"
            )}
          </h3>
          <p className="font-lato text-text-muted mt-0.5 text-xs">
            {req.tournament?.organization?.name ?? "Unknown organizer"}
            {req.tournament && (
              <> · starts {formatCalendarDate(req.tournament.start_date)}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-lato text-text-muted text-xs">
            {formatInstant(req.created_at)}
          </span>
          <StatusBadge status={req.status} />
        </div>
      </div>

      <div>
        <p className="font-lato text-text-muted text-xs tracking-wide uppercase">
          Reason from {requester}
        </p>
        <p className="font-lato text-text-primary mt-1 text-sm whitespace-pre-wrap">
          {req.reason}
        </p>
      </div>

      {req.status === "rejected" && req.rejection_reason && (
        <div className="bg-bg-raised border-border rounded-lg border p-3">
          <p className="font-lato text-text-muted text-xs font-semibold tracking-wide uppercase">
            Rejected — reason
          </p>
          <p className="font-lato text-text-primary mt-1 text-sm">
            {req.rejection_reason}
          </p>
        </div>
      )}

      {req.status === "pending" && (
        <>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowRejectForm((v) => !v);
                setActionError(null);
              }}
              disabled={isPending}
              className="font-lato bg-bg-raised border-border text-text-primary hover:border-gold-dim rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => submit("approve")}
              disabled={isPending}
              className="font-lato bg-danger/10 text-danger border-danger/20 hover:bg-danger/20 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {isPending ? "Processing…" : "Approve Cancellation"}
            </button>
          </div>

          {showRejectForm && (
            <div className="bg-bg-raised border-border rounded-lg border p-4">
              <p className="font-lato text-text-primary mb-2 text-sm font-semibold">
                Reason for rejecting
              </p>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why this cancellation request is being declined. This will be shared with the organizer."
                rows={3}
                className="font-lato bg-bg-base border-border text-text-primary placeholder:text-text-muted focus:border-gold-bright mb-3 w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRejectForm(false);
                    setActionError(null);
                  }}
                  disabled={isPending}
                  className="font-lato bg-bg-base border-border text-text-primary hover:border-gold-dim rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
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
        </>
      )}

      {actionError && (
        <p className="font-lato text-danger text-xs">{actionError}</p>
      )}
    </div>
  );
}

export default function CancellationsClient({ data }: Props) {
  const { counts, requests } = data;
  const [activeTab, setActiveTab] = useState<TabKey>("pending");

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "pending", label: "Pending", count: counts.pending },
    { key: "approved", label: "Approved", count: counts.approved },
    { key: "rejected", label: "Rejected", count: counts.rejected },
    { key: "all", label: "All", count: counts.total },
  ];

  const filtered = useMemo(
    () =>
      activeTab === "all"
        ? requests
        : requests.filter((r) => r.status === activeTab),
    [requests, activeTab],
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          Tournament Cancellations
        </h1>
        <p className="font-lato text-text-muted mt-1 text-sm">
          Review organizer requests to cancel published tournaments. Approving a
          request cancels the tournament and will trigger player refunds.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-border mb-5 flex gap-0 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`font-lato border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
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

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="mb-4 text-4xl opacity-20">♟</div>
          <p className="font-lato text-text-muted text-sm leading-relaxed">
            No cancellation requests in this category.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((req) => (
            <RequestCard key={req.id} req={req} />
          ))}
        </div>
      )}
    </div>
  );
}
