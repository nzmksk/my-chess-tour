"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  ApplicationDetail,
  ApprovalStatus,
  OrgLink,
  OrgLinks,
  PlayerProfile,
} from "../page";

const STATUS_CONFIG: Record<
  ApprovalStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
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

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1 py-2 border-b border-border last:border-0">
      <span className="font-lato text-xs text-text-muted pt-0.5">{label}</span>
      <div className="font-lato text-sm text-text-primary">{children}</div>
    </div>
  );
}

function LinksDisplay({ links }: { links: OrgLinks | null }) {
  if (!links || links.length === 0) return <span className="text-text-muted">—</span>;

  return (
    <div className="flex flex-col gap-1">
      {links.map((entry: OrgLink) => (
        <span key={entry.label}>
          <span className="text-text-muted">{entry.label}:</span>{" "}
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold-bright hover:underline break-all"
          >
            {entry.url}
          </a>
        </span>
      ))}
    </div>
  );
}

function getPlayerProfile(
  raw: PlayerProfile | PlayerProfile[] | null | undefined,
): PlayerProfile | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

interface Props {
  application: ApplicationDetail;
}

export default function ApplicationDetailClient({ application }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const appliedDate = new Date(application.created_at).toLocaleDateString(
    "en-MY",
    { day: "numeric", month: "long", year: "numeric" },
  );

  const appliedTime = new Date(application.created_at).toLocaleTimeString(
    "en-MY",
    { hour: "2-digit", minute: "2-digit" },
  );

  const applicant = application.applicant;
  const profile = getPlayerProfile(applicant?.player_profiles);

  async function handleApprove() {
    setActionError(null);
    startTransition(async () => {
      const res = await fetch(`/api/v1/admin/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setActionError(json.error?.message ?? "Failed to approve application.");
        return;
      }
      router.push("/admin/applications");
      router.refresh();
    });
  }

  async function handleReject() {
    if (!rejectionReason.trim()) {
      setActionError("Please provide a rejection reason.");
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const res = await fetch(`/api/v1/admin/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          rejection_reason: rejectionReason.trim(),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setActionError(json.error?.message ?? "Failed to reject application.");
        return;
      }
      router.push("/admin/applications");
      router.refresh();
    });
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Link
          href="/admin/applications"
          className="font-lato text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          ← Back
        </Link>
        <h1 className="font-cinzel text-2xl font-bold text-text-primary tracking-wide">
          {application.name}
        </h1>
        <StatusBadge status={application.approval_status} />
      </div>

      {/* Action bar */}
      {application.approval_status === "pending" && (
        <div className="card px-5 py-4 flex flex-wrap items-center gap-3 mb-4">
          <span className="font-lato text-sm text-text-muted">
            Applied on {appliedDate} at {appliedTime}
            {applicant && (
              <>
                {" "}
                by{" "}
                <strong className="text-text-primary">
                  {applicant.first_name} {applicant.last_name}
                </strong>
              </>
            )}
          </span>
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={() => {
                setShowRejectForm((v) => !v);
                setActionError(null);
              }}
              disabled={isPending}
              className="font-lato text-sm font-semibold px-4 py-2 rounded-md bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={isPending}
              className="font-lato text-sm font-semibold px-4 py-2 rounded-md bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50"
            >
              {isPending ? "Processing…" : "✓ Approve"}
            </button>
          </div>
        </div>
      )}

      {/* Rejection reason form */}
      {showRejectForm && application.approval_status === "pending" && (
        <div className="mb-4 p-4 rounded-lg bg-danger/10 border border-danger/20">
          <p className="font-lato text-sm font-semibold text-danger mb-3">
            Rejection Reason
          </p>
          <textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Explain why this application is being rejected. This will be communicated to the applicant."
            rows={3}
            className="w-full font-lato text-sm px-3 py-2 bg-bg-raised border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-danger resize-vertical mb-3"
          />
          {actionError && (
            <p className="font-lato text-xs text-danger mb-2">{actionError}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowRejectForm(false);
                setActionError(null);
              }}
              disabled={isPending}
              className="font-lato text-sm font-semibold px-4 py-2 rounded-md bg-bg-raised border border-border text-text-primary hover:border-gold-dim transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={isPending}
              className="font-lato text-sm font-semibold px-4 py-2 rounded-md bg-danger text-white hover:bg-danger/80 transition-colors disabled:opacity-50"
            >
              {isPending ? "Processing…" : "Confirm Rejection"}
            </button>
          </div>
        </div>
      )}

      {/* Action error (outside form, e.g. approve error) */}
      {actionError && !showRejectForm && (
        <p className="font-lato text-xs text-danger mb-4">{actionError}</p>
      )}

      {/* Rejection reason display (already rejected) */}
      {application.approval_status === "rejected" &&
        application.rejection_reason && (
          <div className="mb-4 p-4 rounded-lg bg-danger/10 border border-danger/20">
            <p className="font-lato text-xs font-semibold text-danger mb-1 uppercase tracking-wide">
              Rejection Reason
            </p>
            <p className="font-lato text-sm text-text-primary">
              {application.rejection_reason}
            </p>
          </div>
        )}

      {/* Organization details */}
      <section className="card mb-4 overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-bg-raised">
          <h2 className="font-cinzel text-sm font-bold text-text-primary tracking-wide uppercase">
            Organization Details
          </h2>
        </div>
        <div className="px-5 py-4">
          <DetailRow label="Name">{application.name}</DetailRow>
          <DetailRow label="Description">
            {application.description ?? (
              <span className="text-text-muted">—</span>
            )}
          </DetailRow>
          <DetailRow label="Links">
            <LinksDisplay links={application.links} />
          </DetailRow>
          <DetailRow label="Email">
            {application.email ?? <span className="text-text-muted">—</span>}
          </DetailRow>
          <DetailRow label="Phone">
            {application.phone ?? <span className="text-text-muted">—</span>}
          </DetailRow>
        </div>
      </section>

      {/* Past tournament references */}
      <section className="card mb-4 overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-bg-raised">
          <h2 className="font-cinzel text-sm font-bold text-text-primary tracking-wide uppercase">
            Past Tournament References
          </h2>
        </div>
        <div className="px-5 py-4">
          {application.past_tournament_refs ? (
            <p className="font-lato text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
              {application.past_tournament_refs}
            </p>
          ) : (
            <p className="font-lato text-sm text-text-muted">
              No tournament references provided.
            </p>
          )}
        </div>
      </section>

      {/* Applicant account info */}
      <section className="card mb-4 overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-bg-raised">
          <h2 className="font-cinzel text-sm font-bold text-text-primary tracking-wide uppercase">
            Applicant Account
          </h2>
        </div>
        <div className="px-5 py-4">
          {applicant ? (
            <>
              <DetailRow label="Name">
                {applicant.first_name} {applicant.last_name}
              </DetailRow>
              <DetailRow label="Email">{applicant.email}</DetailRow>
              <DetailRow label="Account Created">
                {new Date(applicant.created_at).toLocaleDateString("en-MY", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </DetailRow>
              <DetailRow label="Player Profile">
                {profile ? (
                  <span>
                    {profile.title && (
                      <span className="font-semibold">{profile.title} · </span>
                    )}
                    {profile.fide_id ? (
                      <>FIDE ID: {profile.fide_id}</>
                    ) : (
                      "No FIDE ID"
                    )}
                    {profile.fide_rating?.rapid != null && (
                      <> · Rapid {profile.fide_rating.rapid}</>
                    )}
                    {profile.fide_rating?.standard != null && (
                      <> · Standard {profile.fide_rating.standard}</>
                    )}
                    {!profile.fide_id &&
                      !profile.title &&
                      !profile.fide_rating?.rapid &&
                      !profile.fide_rating?.standard && (
                        <span className="text-text-muted">
                          No rating information
                        </span>
                      )}
                  </span>
                ) : (
                  <span className="text-text-muted">No player profile</span>
                )}
              </DetailRow>
            </>
          ) : (
            <p className="font-lato text-sm text-text-muted">
              Applicant information not available.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
