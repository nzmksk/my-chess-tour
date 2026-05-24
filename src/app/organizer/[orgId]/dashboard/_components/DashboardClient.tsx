"use client";

import Link from "next/link";

type TournamentStatus = "draft" | "published" | "ongoing" | "completed" | "cancelled";

interface RecentTournament {
  id: string;
  name: string;
  start_date: string;
  current_participants: number;
  max_participants: number;
  status: TournamentStatus;
}

interface Stats {
  active_tournaments: number;
  total_registrations: number;
  total_revenue_cents: number;
  pending_payout_cents: number;
}

interface DashboardData {
  organization: { id: string; name: string };
  stats: Stats;
  recent_tournaments: RecentTournament[];
}

interface Props {
  data: DashboardData;
}

const STATUS_CONFIG: Record<TournamentStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-bg-raised text-text-muted border border-border" },
  published: { label: "Open", className: "bg-success/10 text-success border border-success/20" },
  ongoing: { label: "Ongoing", className: "bg-warning/15 text-warning border border-warning/20" },
  completed: { label: "Completed", className: "bg-bg-raised text-text-muted border border-border" },
  cancelled: { label: "Cancelled", className: "bg-danger/15 text-danger border border-danger/20" },
};

function formatCents(cents: number): string {
  return `MYR ${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card px-5 py-4 flex flex-col gap-1">
      <p className="font-lato text-xs text-text-muted uppercase tracking-widest">{label}</p>
      <p className="font-cinzel text-2xl font-bold text-text-primary">{value}</p>
    </div>
  );
}

function TournamentRow({ tournament }: { tournament: RecentTournament }) {
  const startDate = new Date(tournament.start_date + "T00:00:00");
  const month = startDate.toLocaleString("en-MY", { month: "short" }).toUpperCase();
  const day = startDate.getDate();
  const statusConfig = STATUS_CONFIG[tournament.status] ?? STATUS_CONFIG.draft;

  return (
    <Link
      href={`/tournaments/${tournament.id}`}
      className="flex items-center gap-4 card px-5 py-4 no-underline transition-shadow duration-150 hover:shadow-[0_4px_20px_var(--color-grandiose-hover)]"
    >
      <div className="text-center min-w-12 shrink-0">
        <div className="font-cinzel text-xs font-bold tracking-widest text-gold-bright">{month}</div>
        <div className="font-cinzel text-2xl font-bold text-text-primary leading-tight">{day}</div>
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="font-lato text-sm font-semibold text-text-primary truncate">{tournament.name}</h4>
        <p className="font-lato text-xs text-text-muted mt-0.5">
          {tournament.current_participants} / {tournament.max_participants} participants
        </p>
      </div>

      <span
        className={`font-cinzel text-xs font-bold tracking-widest uppercase px-2.5 py-1 rounded-md whitespace-nowrap ${statusConfig.className}`}
      >
        {statusConfig.label}
      </span>
    </Link>
  );
}

export default function DashboardClient({ data }: Props) {
  const { organization, stats, recent_tournaments } = data;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="font-cinzel text-2xl font-bold text-text-primary tracking-wide">
          {organization.name}
        </h1>
        <p className="font-lato text-sm text-text-muted mt-1">Organizer Dashboard</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <StatCard label="Active Tournaments" value={stats.active_tournaments} />
        <StatCard label="Total Registrations" value={stats.total_registrations} />
        <StatCard label="Total Revenue" value={formatCents(stats.total_revenue_cents)} />
        <StatCard label="Pending Payout" value={formatCents(stats.pending_payout_cents)} />
      </div>

      {/* Recent Tournaments */}
      <div>
        <h2 className="font-cinzel text-base font-bold text-text-primary tracking-wide mb-3">
          Recent Tournaments
        </h2>

        {recent_tournaments.length === 0 ? (
          <div className="text-center py-12 px-5">
            <div className="text-4xl mb-4 opacity-20">♟</div>
            <p className="font-lato text-sm text-text-muted leading-relaxed">
              No tournaments yet. Create your first tournament to get started.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {recent_tournaments.map((t) => (
              <TournamentRow key={t.id} tournament={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
