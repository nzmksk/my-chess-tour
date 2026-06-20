"use client";

import Link from "next/link";
import { useState } from "react";

type TournamentStatus = "draft" | "published" | "ongoing" | "completed" | "cancelled";

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
}

const STATUS_CONFIG: Record<TournamentStatus, { label: string; className: string }> = {
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

const REG_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
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
  return str
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="card px-5 py-4 flex flex-col gap-1">
      <p className="font-lato text-xs text-text-muted uppercase tracking-widest">{label}</p>
      <p className="font-cinzel text-2xl font-bold text-text-primary">{value}</p>
      {note && <p className="font-lato text-xs text-text-muted">{note}</p>}
    </div>
  );
}

export default function TournamentManageClient({ orgId, tournament, stats, participants }: Props) {
  const [search, setSearch] = useState("");
  const statusConfig = STATUS_CONFIG[tournament.status] ?? STATUS_CONFIG.draft;
  const isEditable = tournament.status === "draft" || tournament.status === "published" || tournament.status === "ongoing";

  const filtered = participants.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.fide_id?.toString() ?? "").includes(search),
  );

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Back link */}
      <div className="mb-4">
        <Link
          href={`/organizer/${orgId}/dashboard`}
          className="font-lato text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-cinzel text-2xl font-bold text-text-primary tracking-wide">
            {tournament.name}
          </h1>
          <p className="font-lato text-sm text-text-muted mt-1">
            {formatDate(tournament.start_date)}
            {tournament.start_date !== tournament.end_date && ` – ${formatDate(tournament.end_date)}`}
            {" · "}
            {tournament.venue.name}, {tournament.venue.state}
            {" · "}
            <span
              className={`font-cinzel text-xs font-bold tracking-widest uppercase px-2 py-0.5 rounded-md ${statusConfig.className}`}
            >
              {statusConfig.label}
            </span>
          </p>
        </div>
        {isEditable && (
          <Link
            href={`/organizer/${orgId}/tournaments/${tournament.id}/edit`}
            className="font-cinzel text-gold-bright border-gold-bright/40 hover:border-gold-bright hover:bg-int-gold-bg inline-flex cursor-pointer items-center rounded-md border bg-transparent px-4 py-2 text-xs font-bold tracking-widest uppercase transition duration-150 shrink-0"
          >
            Edit Tournament
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        <StatCard
          label="Registered"
          value={stats.total}
          note={`of ${tournament.max_participants} capacity`}
        />
        <StatCard
          label="Confirmed"
          value={stats.confirmed}
          note="Paid"
        />
        <StatCard
          label="Pending"
          value={stats.pending}
          note="Awaiting payment"
        />
      </div>

      {/* Participants table */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="font-cinzel text-base font-bold text-text-primary tracking-wide">
            Participants ({stats.total})
          </h2>
          {participants.length > 0 && (
            <input
              type="text"
              placeholder="Search by name or FIDE ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input text-sm w-56"
            />
          )}
        </div>

        {participants.length === 0 ? (
          <div className="card text-center py-10 px-5">
            <p className="font-lato text-sm text-text-muted">
              No registrations yet.
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden overflow-x-auto">
            <table className="w-full border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-bg-raised">
                  <th className="font-cinzel text-left px-4 py-3 text-xs font-semibold tracking-widest uppercase text-text-muted w-10">
                    #
                  </th>
                  <th className="font-cinzel text-left px-4 py-3 text-xs font-semibold tracking-widest uppercase text-text-muted">
                    Player
                  </th>
                  <th className="font-cinzel text-left px-4 py-3 text-xs font-semibold tracking-widest uppercase text-text-muted whitespace-nowrap">
                    FIDE ID
                  </th>
                  <th className="font-cinzel text-left px-4 py-3 text-xs font-semibold tracking-widest uppercase text-text-muted">
                    Rating
                  </th>
                  <th className="font-cinzel text-left px-4 py-3 text-xs font-semibold tracking-widest uppercase text-text-muted whitespace-nowrap">
                    Fee Tier
                  </th>
                  <th className="font-cinzel text-left px-4 py-3 text-xs font-semibold tracking-widest uppercase text-text-muted">
                    Status
                  </th>
                  <th className="font-cinzel text-left px-4 py-3 text-xs font-semibold tracking-widest uppercase text-text-muted whitespace-nowrap">
                    Registered
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center font-lato text-sm text-text-muted">
                      No participants match your search.
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const regStatus = REG_STATUS_CONFIG[p.status] ?? {
                      label: toTitleCase(p.status),
                      className: "bg-bg-raised text-text-muted border border-border",
                    };
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-border last:border-b-0 hover:bg-bg-raised transition-colors duration-100"
                      >
                        <td className="px-4 py-3">
                          <span className="font-lato text-sm text-text-muted">{p.index}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-lato text-sm font-semibold text-text-primary">
                            {p.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-lato text-sm text-text-secondary font-mono">
                            {p.fide_id ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-lato text-sm text-text-secondary">
                            {p.rating ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-lato text-sm text-text-secondary">
                            {toTitleCase(p.fee_tier)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-cinzel text-xs font-bold tracking-widest uppercase px-2 py-0.5 rounded-md ${regStatus.className}`}
                          >
                            {regStatus.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-lato text-sm text-text-secondary">
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
    </div>
  );
}
