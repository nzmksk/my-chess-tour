"use client";

import Link from "next/link";
import { useState } from "react";
import TournamentActions from "./TournamentActions";
import {
  canEditAnything,
  resolveEditStage,
} from "@/lib/tournaments/edit-policy";
import {
  formatCalendarDateRange,
  formatInstantDate,
  getTodayInTimeZone,
  resolveTimeZone,
} from "@/lib/tournaments/datetime";
import type { RefundState } from "@/lib/refunds/state";
import { formatRinggit } from "@/services/payouts/format";
import type { PrizesJson } from "@/lib/tournaments/prize-funding";
import PrizePoolPanel from "./PrizePoolPanel";

type TournamentStatus =
  | "draft"
  | "published"
  | "ongoing"
  | "completed"
  | "cancelled";

interface Venue {
  name: string;
  state: string;
  address?: string | null;
}

interface Format {
  type?: string;
  system?: string;
  rounds?: number;
}

interface Tournament {
  id: string;
  name: string;
  status: TournamentStatus;
  start_date: string;
  end_date: string;
  timezone: string;
  registration_deadline: string | null;
  registration_closed_at: string | null;
  venue: Venue;
  format: Format | null;
  max_participants: number;
  organization?: { id: string; name: string | null };
  /** The declared prizes; `distribution: "platform"` means we pay the winners (#523). */
  prizes?: PrizesJson | null;
}

interface Stats {
  total: number;
  confirmed: number;
  pending: number;
}

interface Participant {
  index: number;
  id: string;
  user_id: string;
  name: string;
  fide_id: number | null;
  rating: number | null;
  fee_tier: string;
  status: string;
  registered_at: string;
}

interface Refund {
  id: string;
  player_name: string;
  amount_cents: number;
  state: RefundState;
  requested_at: string;
  processed_at: string | null;
}

interface Props {
  orgId: string;
  tournament: Tournament;
  stats: Stats;
  participants: Participant[];
  cancellationPending: boolean;
  /** null when the viewer can't see refunds (no refund.manage). */
  refunds?: Refund[] | null;
  /**
   * Who is looking. "admin" is the platform admin's read-only view: same
   * details and roster, but no organizer actions (edit, publish, close
   * registration, cancel) — those belong to the organization.
   */
  viewer?: "organizer" | "admin";
}

const STATUS_CONFIG: Record<
  TournamentStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-bg-raised text-text-muted border border-border",
  },
  published: {
    label: "Published",
    className: "bg-success/10 text-success border border-success/20",
  },
  ongoing: {
    label: "Ongoing",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  completed: {
    label: "Completed",
    className: "bg-bg-raised text-text-muted border border-border",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-danger/15 text-danger border border-danger/20",
  },
};

const REG_STATUS_CONFIG: Record<string, { label: string; className: string }> =
  {
    confirmed: {
      label: "Confirmed",
      className: "bg-success/10 text-success border border-success/20",
    },
    pending_payment: {
      label: "Pending",
      className: "bg-warning/15 text-warning border border-warning/20",
    },
  };

const REFUND_STATE_CONFIG: Record<
  RefundState,
  { label: string; className: string }
> = {
  refunded: {
    label: "Refunded",
    className: "bg-success/10 text-success border border-success/20",
  },
  processing: {
    label: "Processing",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  failed: {
    label: "Failed",
    className: "bg-danger/15 text-danger border border-danger/20",
  },
};

const EXPORT_LINK_CLASS =
  "font-cinzel text-gold-bright border-gold-bright/40 hover:border-gold-bright hover:bg-int-gold-bg inline-flex shrink-0 cursor-pointer items-center rounded-md border bg-transparent px-3 py-2 text-xs font-bold tracking-widest uppercase transition duration-150";

function toTitleCase(str: string): string {
  return str.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Refunds to this tournament's players (today: one per paid player when the
// tournament is cancelled). Explains why the tournament's revenue, and so its
// payout, dropped (#511).
function RefundsSection({
  refunds,
  timeZone,
}: {
  refunds: Refund[];
  timeZone: string;
}) {
  const totals = { refunded: 0, processing: 0, failed: 0 };
  for (const r of refunds) totals[r.state] += r.amount_cents;

  const summary = (["refunded", "processing", "failed"] as const)
    .filter((state) => totals[state] > 0)
    .map(
      (state) =>
        `${formatRinggit(totals[state])} ${REFUND_STATE_CONFIG[state].label.toLowerCase()}`,
    )
    .join(" · ");

  return (
    <div className="mb-8">
      <h2 className="font-cinzel text-text-primary mb-1 text-base font-bold tracking-wide">
        Refunds ({refunds.length})
      </h2>
      <p className="font-lato text-text-muted mb-3 text-xs">
        {summary}. Each player gets back what they paid, platform fee included.
        Refunds that have cleared are deducted from this tournament&apos;s
        revenue.
        {totals.failed > 0 &&
          " A failed refund is still owed to the player, and MY Chess Tour support will arrange it with them."}
      </p>
      <div className="card overflow-hidden overflow-x-auto">
        <table className="w-full min-w-120 border-collapse">
          <thead>
            <tr className="border-border bg-bg-raised border-b">
              <th className="font-cinzel text-text-muted px-4 py-3 text-left text-xs font-semibold tracking-widest uppercase">
                Player
              </th>
              <th className="font-cinzel text-text-muted px-4 py-3 text-right text-xs font-semibold tracking-widest uppercase">
                Amount
              </th>
              <th className="font-cinzel text-text-muted px-4 py-3 text-left text-xs font-semibold tracking-widest uppercase">
                Status
              </th>
              <th className="font-cinzel text-text-muted px-4 py-3 text-left text-xs font-semibold tracking-widest uppercase">
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            {refunds.map((r) => {
              const state = REFUND_STATE_CONFIG[r.state];
              return (
                <tr
                  key={r.id}
                  className="border-border border-b last:border-b-0"
                >
                  <td className="font-lato text-text-primary px-4 py-3 text-sm font-semibold">
                    {r.player_name}
                  </td>
                  <td className="font-lato text-text-secondary px-4 py-3 text-right text-sm whitespace-nowrap">
                    {formatRinggit(r.amount_cents)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-cinzel rounded-md px-2 py-0.5 text-xs font-bold tracking-widest uppercase ${state.className}`}
                    >
                      {state.label}
                    </span>
                  </td>
                  <td className="font-lato text-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                    {formatInstantDate(r.processed_at ?? r.requested_at, timeZone, {
                      withZone: false,
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="card flex flex-col gap-1 px-5 py-4">
      <p className="font-lato text-text-muted text-xs tracking-widest uppercase">
        {label}
      </p>
      <p className="font-cinzel text-text-primary text-2xl font-bold">
        {value}
      </p>
      {note && <p className="font-lato text-text-muted text-xs">{note}</p>}
    </div>
  );
}

export default function TournamentManageClient({
  orgId,
  tournament,
  stats,
  participants,
  cancellationPending,
  refunds = null,
  viewer = "organizer",
}: Props) {
  const isAdminView = viewer === "admin";
  const [search, setSearch] = useState("");
  const statusConfig = STATUS_CONFIG[tournament.status] ?? STATUS_CONFIG.draft;
  // Offered while the edit policy leaves anything editable: up to the end date
  // (only the description, once started), never once cancelled. Past the end
  // date the PATCH route refuses every field, so offering the button would
  // just walk the organizer into a 409. "ongoing" and "completed" are
  // date-derived and never stored, so the status column alone can't answer
  // this; resolve today in the venue's own timezone, exactly as the server
  // does. Whether anyone has paid only decides WHICH fields are editable, so
  // it doesn't matter here.
  const isEditable =
    !isAdminView &&
    canEditAnything(
      resolveEditStage({
        status: tournament.status,
        startDate: tournament.start_date,
        endDate: tournament.end_date,
        today: getTodayInTimeZone(tournament.timezone),
        hasPaidRegistration: false,
      }),
    );

  // The whole roster, whatever the search box holds: it seeds pairing software.
  const exportUrl = `/api/v1/organizations/${orgId}/tournaments/${tournament.id}/participants/export`;

  const filtered = participants.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.fide_id?.toString() ?? "").includes(search),
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Back link */}
      <div className="mb-4">
        <Link
          href={isAdminView ? "/admin/dashboard" : `/my/organizations/${orgId}`}
          className="font-lato text-text-muted hover:text-text-primary text-sm transition-colors"
        >
          {isAdminView ? "← Back to Admin Dashboard" : "← Back to Dashboard"}
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
            {tournament.name}
          </h1>
          <p className="font-lato text-text-muted mt-1 text-sm">
            {formatCalendarDateRange(
              tournament.start_date,
              tournament.end_date,
              tournament.timezone,
            )}
            {" · "}
            {tournament.venue.name}, {tournament.venue.state}
            {" · "}
            <span
              className={`font-cinzel rounded-md px-2 py-0.5 text-xs font-bold tracking-widest uppercase ${statusConfig.className}`}
            >
              {statusConfig.label}
            </span>
          </p>
          {isAdminView && tournament.organization?.name && (
            <p className="font-lato text-text-muted mt-1 text-sm">
              Organized by {tournament.organization.name}
            </p>
          )}
        </div>
        {isEditable && (
          <Link
            href={`/my/organizations/${orgId}/tournaments/${tournament.id}/edit`}
            className="font-cinzel text-gold-bright border-gold-bright/40 hover:border-gold-bright hover:bg-int-gold-bg inline-flex shrink-0 cursor-pointer items-center rounded-md border bg-transparent px-4 py-2 text-xs font-bold tracking-widest uppercase transition duration-150"
          >
            Edit Tournament
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Registered"
          value={stats.total}
          note={`of ${tournament.max_participants} capacity`}
        />
        <StatCard label="Confirmed" value={stats.confirmed} note="Paid" />
        <StatCard
          label="Pending"
          value={stats.pending}
          note="Awaiting payment"
        />
      </div>

      {/* The organizer funds the pool and names the winners; admins work from
          /admin/prizes. Not shown on drafts' read-only admin view. */}
      {!isAdminView && tournament.prizes?.distribution === "platform" && (
        <PrizePoolPanel
          orgId={orgId}
          tournamentId={tournament.id}
          prizes={tournament.prizes}
          participants={participants}
        />
      )}

      {refunds && refunds.length > 0 && (
        <RefundsSection
          refunds={refunds}
          timeZone={resolveTimeZone(tournament.timezone)}
        />
      )}

      {/* Participants table */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-cinzel text-text-primary text-base font-bold tracking-wide">
            Participants ({stats.total})
          </h2>
          {participants.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Search by name or FIDE ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input w-56 text-sm"
              />
              {/* The export is org owner/admin only, so not the admin's view. */}
              {!isAdminView && (
                <>
                  <a
                    href={`${exportUrl}?format=csv`}
                    download
                    className={EXPORT_LINK_CLASS}
                  >
                    Export CSV
                  </a>
                  <a
                    href={`${exportUrl}?format=xlsx`}
                    download
                    className={EXPORT_LINK_CLASS}
                  >
                    Export Excel
                  </a>
                </>
              )}
            </div>
          )}
        </div>

        {participants.length === 0 ? (
          <div className="card px-5 py-10 text-center">
            <p className="font-lato text-text-muted text-sm">
              No registrations yet.
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden overflow-x-auto">
            <table className="w-full min-w-160 border-collapse">
              <thead>
                <tr className="border-border bg-bg-raised border-b">
                  <th className="font-cinzel text-text-muted w-10 px-4 py-3 text-left text-xs font-semibold tracking-widest uppercase">
                    #
                  </th>
                  <th className="font-cinzel text-text-muted px-4 py-3 text-left text-xs font-semibold tracking-widest uppercase">
                    Player
                  </th>
                  <th className="font-cinzel text-text-muted px-4 py-3 text-left text-xs font-semibold tracking-widest whitespace-nowrap uppercase">
                    FIDE ID
                  </th>
                  <th className="font-cinzel text-text-muted px-4 py-3 text-left text-xs font-semibold tracking-widest uppercase">
                    Rating
                  </th>
                  <th className="font-cinzel text-text-muted px-4 py-3 text-left text-xs font-semibold tracking-widest whitespace-nowrap uppercase">
                    Fee Tier
                  </th>
                  <th className="font-cinzel text-text-muted px-4 py-3 text-left text-xs font-semibold tracking-widest uppercase">
                    Status
                  </th>
                  <th className="font-cinzel text-text-muted px-4 py-3 text-left text-xs font-semibold tracking-widest whitespace-nowrap uppercase">
                    Registered
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="font-lato text-text-muted px-4 py-8 text-center text-sm"
                    >
                      No participants match your search.
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const regStatus = REG_STATUS_CONFIG[p.status] ?? {
                      label: toTitleCase(p.status),
                      className:
                        "bg-bg-raised text-text-muted border border-border",
                    };
                    return (
                      <tr
                        key={p.id}
                        className="border-border hover:bg-bg-raised border-b transition-colors duration-100 last:border-b-0"
                      >
                        <td className="px-4 py-3">
                          <span className="font-lato text-text-muted text-sm">
                            {p.index}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-lato text-text-primary text-sm font-semibold">
                            {p.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-lato text-text-secondary text-sm">
                            {p.fide_id ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-lato text-text-secondary text-sm">
                            {p.rating ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-lato text-text-secondary text-sm">
                            {toTitleCase(p.fee_tier)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-cinzel rounded-md px-2 py-0.5 text-xs font-bold tracking-widest uppercase ${regStatus.className}`}
                          >
                            {regStatus.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-lato text-text-secondary text-sm">
                            {formatInstantDate(
                              p.registered_at,
                              resolveTimeZone(tournament.timezone),
                              { withZone: false },
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Organizer actions: publish a draft / close registration / request cancellation */}
      {!isAdminView && (
        <TournamentActions
          orgId={orgId}
          tournamentId={tournament.id}
          status={tournament.status}
          startDate={tournament.start_date}
          endDate={tournament.end_date}
          timeZone={tournament.timezone}
          registrationClosedAt={tournament.registration_closed_at}
          registrationDeadline={tournament.registration_deadline}
          cancellationPending={cancellationPending}
        />
      )}
    </div>
  );
}
