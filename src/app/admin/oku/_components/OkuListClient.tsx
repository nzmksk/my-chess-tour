"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { OkuCounts, OkuReviewStatus, OkuSubmission } from "../page";

type TabKey = "all" | OkuReviewStatus;

const STATUS_CONFIG: Record<
  OkuReviewStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  verified: {
    label: "Verified",
    className: "bg-success/10 text-success border border-success/20",
  },
  rejected: {
    label: "Rejected",
    className: "bg-danger/15 text-danger border border-danger/20",
  },
};

function StatusBadge({ status }: { status: OkuReviewStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest whitespace-nowrap uppercase ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function SubmissionRow({ s }: { s: OkuSubmission }) {
  const submitted = new Date(s.submitted_at).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const name = `${s.first_name} ${s.last_name}`.trim() || s.email || s.user_id;

  return (
    <Link
      href={`/admin/oku/${s.user_id}`}
      className="card hover:border-gold-dim flex flex-col gap-2 px-5 py-4 transition-colors sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <h3 className="font-lato text-text-primary text-sm font-semibold">
          {name}
        </h3>
        {s.email && (
          <p className="font-lato text-text-muted mt-0.5 text-xs">{s.email}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-lato text-text-muted text-xs">{submitted}</span>
        <StatusBadge status={s.oku_status} />
      </div>
    </Link>
  );
}

interface Props {
  data: { counts: OkuCounts; submissions: OkuSubmission[] };
}

export default function OkuListClient({ data }: Props) {
  const { counts, submissions } = data;
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [search, setSearch] = useState("");

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "pending", label: "Pending", count: counts.pending },
    { key: "verified", label: "Verified", count: counts.verified },
    { key: "rejected", label: "Rejected", count: counts.rejected },
    { key: "all", label: "All", count: counts.total },
  ];

  const filtered = useMemo(() => {
    const byTab =
      activeTab === "all"
        ? submissions
        : submissions.filter((s) => s.oku_status === activeTab);
    if (!search.trim()) return byTab;
    const q = search.toLowerCase();
    return byTab.filter(
      (s) =>
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q),
    );
  }, [submissions, activeTab, search]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          OKU Verification
        </h1>
        <p className="font-lato text-text-muted mt-1 text-sm">
          Review uploaded OKU cards and approve or reject verification.
        </p>
      </div>

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

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="font-lato bg-bg-raised border-border text-text-primary placeholder:text-text-muted focus:border-gold-bright w-full rounded-lg border px-4 py-2.5 text-sm transition-colors focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="mb-4 text-4xl opacity-20">♟</div>
          <p className="font-lato text-text-muted text-sm">
            {search.trim()
              ? "No submissions match your search."
              : "No submissions in this category."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((s) => (
            <SubmissionRow key={s.user_id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}
