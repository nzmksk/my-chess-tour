"use client";

import Link from "next/link";

type TournamentStatus =
  | "draft"
  | "published"
  | "ongoing"
  | "completed"
  | "cancelled";

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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCents(cents: number): string {
  return `MYR ${(cents / 100).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getActionConfig(status: TournamentStatus): {
  label: string;
  pathSuffix: string;
} {
  switch (status) {
    case "draft":
      return { label: "Edit", pathSuffix: "/edit" };
    case "published":
    case "ongoing":
      return { label: "Manage", pathSuffix: "" };
    case "completed":
    case "cancelled":
    default:
      return { label: "View", pathSuffix: "" };
  }
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card flex flex-col gap-1 px-5 py-4">
      <p className="font-lato text-text-muted text-xs tracking-widest uppercase">
        {label}
      </p>
      <p className="font-cinzel text-text-primary text-2xl font-bold">
        {value}
      </p>
    </div>
  );
}

interface TournamentRowProps {
  tournament: RecentTournament;
  orgId: string;
}

function TournamentRow({ tournament: t, orgId }: TournamentRowProps) {
  const statusConfig = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.draft;
  const actionConfig = getActionConfig(t.status);
  const basePath = `/organizations/${orgId}/tournaments/${t.id}`;
  const isDimmed = t.status === "completed" || t.status === "cancelled";

  return (
    <tr
      className={`border-border hover:bg-bg-raised border-b transition-colors last:border-b-0 duration-100${isDimmed ? "opacity-60" : ""}`}
    >
      <td className="px-5 py-3.5">
        <span className="font-lato text-text-primary text-sm font-semibold">
          {t.name}
        </span>
      </td>
      <td className="px-5 py-3.5 whitespace-nowrap">
        <span className="font-lato text-text-secondary text-sm">
          {formatDate(t.start_date)}
        </span>
      </td>
      <td className="px-5 py-3.5 whitespace-nowrap">
        <span className="font-lato text-text-secondary text-sm">
          {t.current_participants} / {t.max_participants}
        </span>
      </td>
      <td className="px-5 py-3.5">
        <span
          className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest whitespace-nowrap uppercase ${statusConfig.className}`}
        >
          {statusConfig.label}
        </span>
      </td>
      <td className="px-5 py-3.5 text-right">
        <Link
          href={`${basePath}${actionConfig.pathSuffix}`}
          className="font-cinzel text-gold-bright border-gold-bright/40 hover:border-gold-bright hover:bg-int-gold-bg inline-flex cursor-pointer items-center rounded-md border bg-transparent px-3 py-1.5 text-xs font-bold tracking-widest uppercase transition duration-150"
        >
          {actionConfig.label}
        </Link>
      </td>
    </tr>
  );
}

export default function DashboardClient({ data }: Props) {
  const { organization, stats, recent_tournaments } = data;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
            {organization.name}
          </h1>
          <p className="font-lato text-text-muted mt-1 text-sm">
            Organizer Dashboard
          </p>
        </div>
        <Link
          href={`/organizations/${organization.id}/tournaments/create`}
          className="font-cinzel text-bg-base shrink-0 cursor-pointer rounded-md border-0 px-4 py-2 text-xs font-bold tracking-widest uppercase transition duration-200 hover:opacity-90"
          style={{
            background:
              "linear-gradient(135deg, var(--color-gold-bright), var(--color-gold-deep))",
          }}
        >
          + Create
        </Link>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-3">
        <StatCard label="Active Tournaments" value={stats.active_tournaments} />
        <StatCard
          label="Total Registrations"
          value={stats.total_registrations}
        />
        <StatCard
          label="Total Revenue"
          value={formatCents(stats.total_revenue_cents)}
        />
        <StatCard
          label="Pending Payout"
          value={formatCents(stats.pending_payout_cents)}
        />
      </div>

      {/* Quick Links */}
      <div className="mb-8">
        <h2 className="font-cinzel text-text-primary mb-3 text-base font-bold tracking-wide">
          Manage
        </h2>
        <Link
          href={`/organizations/${organization.id}/members`}
          className="card flex items-center justify-between px-5 py-4 no-underline transition-shadow duration-150 hover:shadow-[0_4px_20px_var(--color-grandiose-hover)]"
        >
          <div className="flex items-center gap-3">
            <span className="text-gold-bright text-xl">♟</span>
            <div>
              <p className="font-lato text-text-primary text-sm font-semibold">
                Members
              </p>
              <p className="font-lato text-text-muted mt-0.5 text-xs">
                View and manage organization members
              </p>
            </div>
          </div>
          <span className="text-text-muted text-lg">›</span>
        </Link>
      </div>

      {/* Tournament Table */}
      <div>
        <h2 className="font-cinzel text-text-primary mb-3 text-base font-bold tracking-wide">
          Your Tournaments
        </h2>

        {recent_tournaments.length === 0 ? (
          <div className="card px-5 py-12 text-center">
            <div className="mb-4 text-4xl opacity-20">♟</div>
            <p className="font-lato text-text-muted text-sm leading-relaxed">
              No tournaments yet. Create your first tournament to get started.
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden overflow-x-auto">
            <table className="w-full min-w-150 border-collapse">
              <thead>
                <tr className="border-border bg-bg-raised border-b">
                  <th className="font-cinzel text-text-muted px-5 py-3 text-left text-xs font-semibold tracking-widest uppercase">
                    Tournament
                  </th>
                  <th className="font-cinzel text-text-muted px-5 py-3 text-left text-xs font-semibold tracking-widest whitespace-nowrap uppercase">
                    Date
                  </th>
                  <th className="font-cinzel text-text-muted px-5 py-3 text-left text-xs font-semibold tracking-widest whitespace-nowrap uppercase">
                    Registrations
                  </th>
                  <th className="font-cinzel text-text-muted px-5 py-3 text-left text-xs font-semibold tracking-widest uppercase">
                    Status
                  </th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {recent_tournaments.map((t) => (
                  <TournamentRow
                    key={t.id}
                    tournament={t}
                    orgId={organization.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
