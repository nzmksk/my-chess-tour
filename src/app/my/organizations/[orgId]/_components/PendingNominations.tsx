"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCalendarDate } from "@/lib/tournaments/datetime";

export interface PendingNomination {
  tournament_id: string;
  tournament_name: string;
  start_date: string;
  organizing_organization: string | null;
}

function NominationRow({
  organizationId,
  nomination: n,
}: {
  organizationId: string;
  nomination: PendingNomination;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/v1/organizations/${organizationId}/nominations/${n.tournament_id}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error?.message ?? "Failed to accept this nomination.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-lato text-text-primary text-sm font-semibold">
          {n.tournament_name}
        </p>
        <p className="font-lato text-text-muted mt-0.5 text-xs">
          Organized by {n.organizing_organization ?? "another organization"} ·
          starts {formatCalendarDate(n.start_date)}
        </p>
        {error && <p className="font-lato text-danger mt-1 text-xs">{error}</p>}
      </div>
      <button
        type="button"
        onClick={accept}
        disabled={isPending}
        className="btn-primary shrink-0 rounded-md disabled:opacity-50"
      >
        {isPending ? "Accepting…" : "Accept"}
      </button>
    </div>
  );
}

/**
 * Tournaments nominating this organization to receive their payout. Nothing is
 * redirected until it is accepted here, so a one-sided nomination can't move money.
 * Renders nothing when there are none. The API only returns these to people who can
 * accept them.
 */
export default function PendingNominations({
  organizationId,
  nominations,
}: {
  organizationId: string;
  nominations: PendingNomination[];
}) {
  if (nominations.length === 0) return null;

  return (
    <section className="border-gold-dim bg-bg-raised mb-8 rounded-md border p-5">
      <h2 className="font-cinzel text-text-primary mb-2 text-base font-bold tracking-wide">
        Payout nominations
      </h2>
      <p className="font-lato text-text-secondary mb-4 text-sm">
        These tournaments have nominated your organization to receive their
        payout, to your verified bank account. Accept only if you expect the
        money. Early payouts aren&apos;t available for these tournaments.
      </p>
      <div className="flex flex-col gap-4">
        {nominations.map((n) => (
          <NominationRow
            key={n.tournament_id}
            organizationId={organizationId}
            nomination={n}
          />
        ))}
      </div>
    </section>
  );
}
