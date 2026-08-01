"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getTournamentDateState } from "@/app/tournaments/utils";
import { getTodayInTimeZone } from "@/lib/datetime";
import { registrationStatus as computeRegistrationStatus } from "@/lib/registration-status";

interface Props {
  orgId: string;
  tournamentId: string;
  status: string;
  startDate: string;
  endDate: string;
  /** The venue's timezone — the zone the tournament's dates are read in. */
  timeZone: string;
  registrationClosedAt: string | null;
  registrationDeadline: string | null;
  cancellationPending: boolean;
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// These actions only make sense for a live, published tournament. Guard here,
// before any hooks mount, so drafts/cancelled tournaments render nothing (and
// static renders without a router context don't invoke the router hook).
export default function TournamentActions(props: Props) {
  if (props.status !== "published") return null;
  return <PublishedActions {...props} />;
}

function PublishedActions({
  orgId,
  tournamentId,
  startDate,
  endDate,
  timeZone,
  registrationClosedAt,
  registrationDeadline,
  cancellationPending,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmClose, setConfirmClose] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // registrationClosedAt is the effective close time (the deadline by default,
  // earlier if closed early). A closed-early row is always already past, so
  // isClosed alone gates the "Close Registration" action.
  const { isClosed: registrationClosed, closedEarly } = registrationDeadline
    ? computeRegistrationStatus(registrationClosedAt, registrationDeadline)
    : { isClosed: false, closedEarly: false };

  // Cancellation only makes sense before a tournament starts. Once it's ongoing
  // or completed (both still `published` in the DB — those states are purely
  // date-derived), hide the action. The server enforces the same rule.
  const cancellable =
    getTournamentDateState(startDate, endDate, getTodayInTimeZone(timeZone)) ===
    "upcoming";

  const base = `/api/v1/organizations/${orgId}/tournaments/${tournamentId}`;

  function closeRegistration() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`${base}/close-registration`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error?.message ?? "Failed to close registration.");
        return;
      }
      setConfirmClose(false);
      router.refresh();
    });
  }

  function requestCancellation() {
    if (!cancelReason.trim()) {
      setError("Please provide a reason for cancelling.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`${base}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(
          json.error?.message ?? "Failed to submit cancellation request.",
        );
        return;
      }
      setShowCancelForm(false);
      setCancelReason("");
      router.refresh();
    });
  }

  return (
    <div className="mt-10">
      <h2 className="font-cinzel text-text-primary mb-3 text-base font-bold tracking-wide">
        Tournament Actions
      </h2>

      <div className="border-danger/25 flex flex-col gap-6 rounded-lg border px-5 py-5">
        {/* Close registration */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md">
            <h3 className="font-lato text-text-primary text-sm font-semibold">
              Close registration early
            </h3>
            <p className="font-lato text-text-muted mt-1 text-sm">
              {closedEarly && registrationClosedAt
                ? `Registration was closed early on ${formatDateTime(registrationClosedAt)}.`
                : registrationClosed
                  ? "Registration has already closed at its deadline."
                  : "Stop accepting new registrations before the deadline. This cannot be undone — registration cannot be re-opened."}
            </p>
          </div>

          {!registrationClosed && !confirmClose && (
            <button
              type="button"
              onClick={() => {
                setConfirmClose(true);
                setError(null);
              }}
              disabled={isPending}
              className="font-lato bg-bg-raised border-border text-text-primary hover:border-gold-dim shrink-0 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              Close Registration
            </button>
          )}
        </div>

        {confirmClose && !registrationClosed && (
          <div className="bg-warning/10 border-warning/20 rounded-lg border p-4">
            <p className="font-lato text-text-primary text-sm">
              Close registration now? Players will no longer be able to
              register, and <strong>this cannot be reversed</strong>.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmClose(false);
                  setError(null);
                }}
                disabled={isPending}
                className="font-lato bg-bg-raised border-border text-text-primary hover:border-gold-dim rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                Keep Open
              </button>
              <button
                type="button"
                onClick={closeRegistration}
                disabled={isPending}
                className="font-lato bg-warning/20 text-warning border-warning/30 hover:bg-warning/30 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {isPending ? "Closing…" : "Yes, Close Registration"}
              </button>
            </div>
          </div>
        )}

        <div className="border-border border-t" />

        {/* Cancel tournament */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md">
            <h3 className="font-lato text-text-primary text-sm font-semibold">
              Cancel this tournament
            </h3>
            <p className="font-lato text-text-muted mt-1 text-sm">
              {cancellationPending
                ? "A cancellation request has been submitted and is awaiting platform-admin approval."
                : !cancellable
                  ? "This tournament has already started or finished and can no longer be cancelled."
                  : "Request to cancel this tournament. A platform admin must approve it; once approved the tournament is cancelled and refunds are initiated for registered players."}
            </p>
          </div>

          {!cancellationPending && !showCancelForm && cancellable && (
            <button
              type="button"
              onClick={() => {
                setShowCancelForm(true);
                setError(null);
              }}
              disabled={isPending}
              className="font-lato bg-danger/10 text-danger border-danger/20 hover:bg-danger/20 shrink-0 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              Request Cancellation
            </button>
          )}
        </div>

        {cancellationPending && (
          <div className="bg-warning/10 border-warning/20 rounded-lg border px-4 py-3">
            <p className="font-lato text-warning text-sm font-semibold">
              Cancellation pending admin approval
            </p>
          </div>
        )}

        {showCancelForm && !cancellationPending && (
          <div className="bg-danger/10 border-danger/20 rounded-lg border p-4">
            <p className="font-lato text-text-primary mb-1 text-sm font-semibold">
              Reason for cancellation
            </p>
            <p className="font-lato text-text-muted mb-3 text-xs">
              This request goes to platform admins for approval. Once approved,
              the tournament is cancelled and refunds are initiated for
              registered players.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Venue is no longer available for the scheduled dates."
              rows={3}
              className="font-lato bg-bg-base border-border text-text-primary placeholder:text-text-muted focus:border-danger mb-3 w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCancelForm(false);
                  setCancelReason("");
                  setError(null);
                }}
                disabled={isPending}
                className="font-lato bg-bg-base border-border text-text-primary hover:border-gold-dim rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                Never Mind
              </button>
              <button
                type="button"
                onClick={requestCancellation}
                disabled={isPending}
                className="font-lato bg-danger hover:bg-danger/80 rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
              >
                {isPending ? "Submitting…" : "Submit Cancellation Request"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="font-lato text-danger text-xs">{error}</p>}
      </div>
    </div>
  );
}
