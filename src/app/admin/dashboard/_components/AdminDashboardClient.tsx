"use client";

import Link from "next/link";

type TournamentStatus = "draft" | "published" | "ongoing" | "completed" | "cancelled";

interface PendingOrganization {
  id: string;
  name: string;
  email: string | null;
  created_at: string;
}

interface RecentTournament {
  id: string;
  name: string;
  organization_name: string | null;
  start_date: string;
  status: string;
  current_participants: number;
  max_participants: number;
}

interface AdminDashboardData {
  stats: {
    total_users: number;
    organizations: {
      total: number;
      pending: number;
      approved: number;
      rejected: number;
    };
    tournaments: {
      total: number;
      published: number;
      draft: number;
      cancelled: number;
    };
    total_registrations: number;
    platform_revenue_cents: number;
  };
  pending_organizations: PendingOrganization[];
  recent_tournaments: RecentTournament[];
}

interface Props {
  data: AdminDashboardData;
}

const TOUR_STATUS_CONFIG: Record<TournamentStatus, { label: string; className: string }> = {
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

function SubStatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-lato text-xs text-text-muted">{label}</span>
      <span className="font-lato text-xs font-semibold text-text-primary">{value}</span>
    </div>
  );
}

function GroupCard({
  label,
  total,
  breakdown,
}: {
  label: string;
  total: number;
  breakdown: { label: string; value: number }[];
}) {
  return (
    <div className="card px-5 py-4 flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="font-lato text-xs text-text-muted uppercase tracking-widest">{label}</p>
        <p className="font-cinzel text-2xl font-bold text-text-primary">{total}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        {breakdown.map((b) => (
          <SubStatRow key={b.label} label={b.label} value={b.value} />
        ))}
      </div>
    </div>
  );
}

function PendingOrgRow({ org }: { org: PendingOrganization }) {
  const createdAt = new Date(org.created_at);
  const dateStr = createdAt.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="card px-5 py-4 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <h4 className="font-lato text-sm font-semibold text-text-primary truncate">{org.name}</h4>
        {org.email && (
          <p className="font-lato text-xs text-text-muted mt-0.5 truncate">{org.email}</p>
        )}
        <p className="font-lato text-xs text-text-muted mt-0.5">Applied {dateStr}</p>
      </div>
      <span className="font-cinzel text-xs font-bold tracking-widest uppercase px-2.5 py-1 rounded-md whitespace-nowrap bg-warning/15 text-warning border border-warning/20">
        Pending
      </span>
    </div>
  );
}

function TournamentRow({ tournament }: { tournament: RecentTournament }) {
  const startDate = new Date(tournament.start_date + "T00:00:00");
  const month = startDate.toLocaleString("en-MY", { month: "short" }).toUpperCase();
  const day = startDate.getDate();
  const status = tournament.status as TournamentStatus;
  const statusConfig = TOUR_STATUS_CONFIG[status] ?? TOUR_STATUS_CONFIG.draft;

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
        {tournament.organization_name && (
          <p className="font-lato text-xs text-text-muted mt-0.5 truncate">{tournament.organization_name}</p>
        )}
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

export default function AdminDashboardClient({ data }: Props) {
  const { stats, pending_organizations, recent_tournaments } = data;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="font-cinzel text-2xl font-bold text-text-primary tracking-wide">
          Platform Admin
        </h1>
        <p className="font-lato text-sm text-text-muted mt-1">Admin Dashboard</p>
      </div>

      {/* Top-level stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard label="Total Users" value={stats.total_users} />
        <StatCard label="Total Registrations" value={stats.total_registrations} />
      </div>

      {/* Group stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <GroupCard
          label="Organizations"
          total={stats.organizations.total}
          breakdown={[
            { label: "Approved", value: stats.organizations.approved },
            { label: "Pending", value: stats.organizations.pending },
            { label: "Rejected", value: stats.organizations.rejected },
          ]}
        />
        <GroupCard
          label="Tournaments"
          total={stats.tournaments.total}
          breakdown={[
            { label: "Published", value: stats.tournaments.published },
            { label: "Draft", value: stats.tournaments.draft },
            { label: "Cancelled", value: stats.tournaments.cancelled },
          ]}
        />
      </div>

      {/* Revenue */}
      <div className="mb-8">
        <StatCard label="Platform Revenue" value={formatCents(stats.platform_revenue_cents)} />
      </div>

      {/* Pending org applications */}
      <div className="mb-8">
        <h2 className="font-cinzel text-base font-bold text-text-primary tracking-wide mb-3">
          Pending Applications
        </h2>

        {pending_organizations.length === 0 ? (
          <div className="text-center py-10 px-5">
            <div className="text-4xl mb-4 opacity-20">♟</div>
            <p className="font-lato text-sm text-text-muted leading-relaxed">
              No pending organization applications.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pending_organizations.map((org) => (
              <PendingOrgRow key={org.id} org={org} />
            ))}
          </div>
        )}
      </div>

      {/* Recent tournaments */}
      <div>
        <h2 className="font-cinzel text-base font-bold text-text-primary tracking-wide mb-3">
          Recent Tournaments
        </h2>

        {recent_tournaments.length === 0 ? (
          <div className="text-center py-10 px-5">
            <div className="text-4xl mb-4 opacity-20">♟</div>
            <p className="font-lato text-sm text-text-muted leading-relaxed">
              No tournaments on the platform yet.
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
