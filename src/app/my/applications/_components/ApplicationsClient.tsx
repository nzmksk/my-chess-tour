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
      className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest whitespace-nowrap uppercase ${className}`}
    >
      {label}
    </span>
  );
}

function ApplicationCardContent({
  application,
}: {
  application: OrgApplication;
}) {
  const submittedDate = new Date(application.created_at);
  const month = submittedDate
    .toLocaleString("en-MY", { month: "short" })
    .toUpperCase();
  const day = submittedDate.getDate();

  return (
    <>
      {/* Date block */}
      <div className="min-w-12 shrink-0 text-center">
        <div className="font-cinzel text-gold-bright text-xs font-bold tracking-widest">
          {month}
        </div>
        <div className="font-cinzel text-text-primary text-2xl leading-tight font-bold">
          {day}
        </div>
      </div>

      {/* Application info */}
      <div className="min-w-0 flex-1">
        <h4 className="font-lato text-text-primary truncate text-sm font-semibold">
          {application.name}
        </h4>
        {application.rejection_reason ? (
          <p className="font-lato text-danger mt-0.5 line-clamp-1 text-xs">
            {application.rejection_reason}
          </p>
        ) : (
          <p className="font-lato text-text-muted mt-0.5 text-xs">
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
        href={`/organizations/${application.id}/dashboard`}
        className="card flex items-center gap-4 px-5 py-4 no-underline transition-shadow duration-150 hover:shadow-[0_4px_20px_var(--color-grandiose-hover)]"
      >
        <ApplicationCardContent application={application} />
      </Link>
    );
  }

  return (
    <div className="card flex items-center gap-4 px-5 py-4">
      <ApplicationCardContent application={application} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-5 py-16 text-center">
      <div className="mb-4 text-4xl opacity-20">♟</div>
      <p className="font-lato text-text-muted text-sm leading-relaxed">
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
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          My Organizations
        </h1>
        {applications.length > 0 && (
          <Link
            href="/organizations/apply"
            className="btn-secondary px-4 py-2 text-xs"
          >
            Apply Again
          </Link>
        )}
      </div>
      <p className="font-lato text-text-muted mb-6 text-sm">
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
