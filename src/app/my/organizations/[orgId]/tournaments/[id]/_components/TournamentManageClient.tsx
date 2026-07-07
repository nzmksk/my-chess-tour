"use client";

import Link from "next/link";
import { useState } from "react";
import TournamentActions from "./TournamentActions";

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
  registration_deadline: string | null;
  registration_closed_at: string | null;
  venue: Venue;
  format: Format | null;
  max_participants: number;
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

interface Props {
  orgId: string;
  tournament: Tournament;
  stats: Stats;
  participants: Participant[];
  cancellationPending: boolean;
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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function toTitleCase(str: string): string {
  return str.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
}: Props) {
  const [search, setSearch] = useState("");
  const statusConfig = STATUS_CONFIG[tournament.status] ?? STATUS_CONFIG.draft;
  const isEditable =
    tournament.status === "draft" ||
    tournament.status === "published" ||
    tournament.status === "ongoing";

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
          href={`/my/organizations/${orgId}`}
          className="font-lato text-text-muted hover:text-text-primary text-sm transition-colors"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
            {tournament.name}
          </h1>
          <p className="font-lato text-text-muted mt-1 text-sm">
            {formatDate(tournament.start_date)}
            {tournament.start_date !== tournament.end_date &&
              ` – ${formatDate(tournament.end_date)}`}
            {" · "}
            {tournament.venue.name}, {tournament.venue.state}
            {" · "}
            <span
              className={`font-cinzel rounded-md px-2 py-0.5 text-xs font-bold tracking-widest uppercase ${statusConfig.className}`}
            >
              {statusConfig.label}
            </span>
          </p>
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

      {/* Participants table */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-cinzel text-text-primary text-base font-bold tracking-wide">
            Participants ({stats.total})
          </h2>
          {participants.length > 0 && (
            <input
              type="text"
              placeholder="Search by name or FIDE ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input w-56 text-sm"
            />
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
                            {formatDateTime(p.registered_at)}
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

      {/* Organizer actions: close registration / request cancellation */}
      <TournamentActions
        orgId={orgId}
        tournamentId={tournament.id}
        status={tournament.status}
        registrationClosedAt={tournament.registration_closed_at}
        registrationDeadline={tournament.registration_deadline}
        cancellationPending={cancellationPending}
      />
    </div>
  );
}
