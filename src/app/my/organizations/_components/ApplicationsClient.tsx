"use client";

import Link from "next/link";
import type { OrgApplication, ApprovalStatus } from "../types";

interface Props {
  applications: OrgApplication[];
}

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const config: Record<ApprovalStatus, { label: string; className: string }> = {
    pending: {
      label: "Under Review",
      className: "bg-warning/15 text-warning border border-warning/20",
    },
    approved: {
      label: "Approved",
      className: "bg-success/10 text-success border border-success/20",
    },
    rejected: {
      label: "Rejected",
      className: "bg-danger/15 text-danger border border-danger/20",
    },
  };

  const { label, className } = config[status] ?? config.pending;

  return (
    <span
      className={`font-cinzel text-xs font-bold tracking-widest uppercase px-2.5 py-1 rounded-md whitespace-nowrap ${className}`}
    >
      {label}
    </span>
  );
}

function ApplicationCardContent({ application }: { application: OrgApplication }) {
  const submittedDate = new Date(application.created_at);
  const month = submittedDate
    .toLocaleString("en-MY", { month: "short" })
    .toUpperCase();
  const day = submittedDate.getDate();

  return (
    <>
      {/* Date block */}
      <div className="text-center min-w-12 shrink-0">
        <div className="font-cinzel text-xs font-bold tracking-widest text-gold-bright">
          {month}
        </div>
        <div className="font-cinzel text-2xl font-bold text-text-primary leading-tight">
          {day}
        </div>
      </div>

      {/* Application info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-lato text-sm font-semibold text-text-primary truncate">
          {application.name}
        </h4>
        {application.rejection_reason ? (
          <p className="font-lato text-xs text-danger mt-0.5 line-clamp-1">
            {application.rejection_reason}
          </p>
        ) : (
          <p className="font-lato text-xs text-text-muted mt-0.5">
            {application.approval_status === "pending"
              ? "Typically reviewed within 1–2 business days"
              : application.reviewed_at
                ? `Reviewed on ${new Date(application.reviewed_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}`
                : ""}
          </p>
        )}
      </div>

      {/* Status badge */}
      <StatusBadge status={application.approval_status} />
    </>
  );
}

function ApplicationCard({ application }: { application: OrgApplication }) {
  if (application.approval_status === "approved") {
    return (
      <Link
        href={`/organizer/${application.id}/dashboard`}
        className="flex items-center gap-4 card px-5 py-4 no-underline transition-shadow duration-150 hover:shadow-[0_4px_20px_var(--color-grandiose-hover)]"
      >
        <ApplicationCardContent application={application} />
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-4 card px-5 py-4">
      <ApplicationCardContent application={application} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 px-5">
      <div className="text-4xl mb-4 opacity-20">♟</div>
      <p className="font-lato text-sm text-text-muted leading-relaxed">
        You haven&apos;t applied to become an organizer yet.
      </p>
      <Link
        href="/organizations/apply"
        className="btn-secondary mt-4 inline-block px-5 py-2 text-xs"
      >
        Apply as Organizer
      </Link>
    </div>
  );
}

export default function ApplicationsClient({ applications }: Props) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-cinzel text-2xl font-bold text-text-primary tracking-wide">
          My Organizations
        </h1>
        {applications.length > 0 && (
          <Link
            href="/organizations/apply"
            className="btn-secondary text-xs px-4 py-2"
          >
            Apply Again
          </Link>
        )}
      </div>
      <p className="font-lato text-sm text-text-muted mb-6">
        Track your organizer applications and their review status.
      </p>

      {applications.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {applications.map((app) => (
            <ApplicationCard key={app.id} application={app} />
          ))}
        </div>
      )}
    </div>
  );
}
