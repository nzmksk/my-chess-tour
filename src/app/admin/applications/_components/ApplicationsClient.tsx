"use client";

import { useState, useMemo } from "react";
import type { Application, ApplicationCounts, ApprovalStatus } from "../page";

type TabKey = "all" | ApprovalStatus;

interface Props {
  data: {
    counts: ApplicationCounts;
    applications: Application[];
  };
}

const STATUS_CONFIG: Record<
  ApprovalStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className:
      "bg-warning/15 text-warning border border-warning/20",
  },
  approved: {
    label: "Approved",
    className:
      "bg-success/10 text-success border border-success/20",
  },
  rejected: {
    label: "Cancelled",
    className:
      "bg-danger/15 text-danger border border-danger/20",
  },
};

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`font-cinzel text-xs font-bold tracking-widest uppercase px-2.5 py-1 rounded-md whitespace-nowrap ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function ApplicationRow({ app }: { app: Application }) {
  const appliedDate = new Date(app.created_at).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="card px-5 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex-1 min-w-0">
        <h3 className="font-lato text-sm font-semibold text-text-primary">
          {app.name}
        </h3>
        {app.description && (
          <p className="font-lato text-xs text-text-muted mt-0.5 line-clamp-1">
            {app.description}
          </p>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {app.email && (
            <span className="font-lato text-xs text-text-muted">{app.email}</span>
          )}
          {app.phone && (
            <span className="font-lato text-xs text-text-muted">{app.phone}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <span className="font-lato text-xs text-text-muted">{appliedDate}</span>
        <StatusBadge status={app.approval_status} />
      </div>
    </div>
  );
}

export default function ApplicationsClient({ data }: Props) {
  const { counts, applications } = data;
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [search, setSearch] = useState("");

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "pending", label: "Pending", count: counts.pending },
    { key: "approved", label: "Approved", count: counts.approved },
    { key: "rejected", label: "Rejected", count: counts.rejected },
    { key: "all", label: "All", count: counts.total },
  ];

  const filtered = useMemo(() => {
    const byTab =
      activeTab === "all"
        ? applications
        : applications.filter((a) => a.approval_status === activeTab);

    if (!search.trim()) return byTab;

    const q = search.toLowerCase();
    return byTab.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q),
    );
  }, [applications, activeTab, search]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="font-cinzel text-2xl font-bold text-text-primary tracking-wide">
          Organizer Applications
        </h1>
        <p className="font-lato text-sm text-text-muted mt-1">
          Review and manage organizer applications.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border mb-5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`font-lato text-sm font-medium px-4 py-3 border-b-2 transition-colors ${
              activeTab === tab.key
                ? "text-text-primary border-gold-bright"
                : "text-text-muted border-transparent hover:text-text-primary"
            }`}
          >
            {tab.label}
            <span className="ml-1.5 font-lato text-xs">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search applications..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full font-lato text-sm px-4 py-2.5 bg-bg-raised border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-gold-bright transition-colors"
        />
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="text-center py-10 px-5">
          <div className="text-4xl mb-4 opacity-20">♟</div>
          <p className="font-lato text-sm text-text-muted leading-relaxed">
            {search.trim()
              ? "No applications match your search."
              : "No applications in this category."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((app) => (
            <ApplicationRow key={app.id} app={app} />
          ))}
        </div>
      )}
    </div>
  );
}
