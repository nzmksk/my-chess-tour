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

const ENTITY_LABELS: Record<string, string> = {
  company: "Company (Sdn Bhd / Enterprise)",
  society: "Society / Association",
  individual: "Individual organizer",
};

const DOC_LABELS: Record<string, string> = {
  ssm: "SSM registration",
  ros: "ROS registration",
  authorization_letter: "Authorization letter",
  identity_document: "Identity document",
  other: "Other supporting document",
};

const BANK_STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting verification",
  verified: "Verified",
  rejected: "Rejected",
};

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
      className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest whitespace-nowrap uppercase ${config.className}`}
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
    <div className="border-border grid grid-cols-[140px_1fr] gap-x-4 gap-y-1 border-b py-2 last:border-0">
      <span className="font-lato text-text-muted pt-0.5 text-xs">{label}</span>
      <div className="font-lato text-text-primary text-sm">{children}</div>
    </div>
  );
}

function LinksDisplay({ links }: { links: OrgLinks | null }) {
  if (!links || links.length === 0)
    return <span className="text-text-muted">—</span>;

  return (
    <div className="flex flex-col gap-1">
      {links.map((entry: OrgLink) => (
        <span key={entry.label}>
          <span className="text-text-muted">{entry.label}:</span>{" "}
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold-bright break-all hover:underline"
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
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href="/admin/applications"
          className="font-lato text-text-muted hover:text-text-primary text-sm transition-colors"
        >
          ← Back
        </Link>
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          {application.name}
        </h1>
        <StatusBadge status={application.approval_status} />
      </div>

      {/* Action bar */}
      {application.approval_status === "pending" && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="font-lato text-text-muted text-sm">
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
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowRejectForm((v) => !v);
                setActionError(null);
              }}
              disabled={isPending}
              className="font-lato bg-danger/10 text-danger border-danger/20 hover:bg-danger/20 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={isPending}
              className="font-lato bg-success/10 text-success border-success/20 hover:bg-success/20 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {isPending ? "Processing…" : "✓ Approve"}
            </button>
          </div>
        </div>
      )}

      {/* Rejection reason form */}
      {showRejectForm && application.approval_status === "pending" && (
        <div className="bg-danger/10 border-danger/20 mb-4 rounded-lg border p-4">
          <p className="font-lato text-danger mb-3 text-sm font-semibold">
            Rejection Reason
          </p>
          <textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Explain why this application is being rejected. This will be communicated to the applicant."
            rows={3}
            className="font-lato bg-bg-raised border-border text-text-primary placeholder:text-text-muted focus:border-danger resize-vertical mb-3 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
          />
          {actionError && (
            <p className="font-lato text-danger mb-2 text-xs">{actionError}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowRejectForm(false);
                setActionError(null);
              }}
              disabled={isPending}
              className="font-lato bg-bg-raised border-border text-text-primary hover:border-gold-dim rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={isPending}
              className="font-lato bg-danger hover:bg-danger/80 rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            >
              {isPending ? "Processing…" : "Confirm Rejection"}
            </button>
          </div>
        </div>
      )}

      {/* Action error (outside form, e.g. approve error) */}
      {actionError && !showRejectForm && (
        <p className="font-lato text-danger mb-4 text-xs">{actionError}</p>
      )}

      {/* Rejection reason display (already rejected) */}
      {application.approval_status === "rejected" &&
        application.rejection_reason && (
          <div className="bg-danger/10 border-danger/20 mb-4 rounded-lg border p-4">
            <p className="font-lato text-danger mb-1 text-xs font-semibold tracking-wide uppercase">
              Rejection Reason
            </p>
            <p className="font-lato text-text-primary text-sm">
              {application.rejection_reason}
            </p>
          </div>
        )}

      {/* Organization details */}
      <section className="card mb-4 overflow-hidden">
        <div className="border-border bg-bg-raised border-b px-5 py-3">
          <h2 className="font-cinzel text-text-primary text-sm font-bold tracking-wide uppercase">
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

      {/* Banking — where this organization's payouts would go */}
      <section className="card mb-4 overflow-hidden">
        <div className="border-border bg-bg-raised border-b px-5 py-3">
          <h2 className="font-cinzel text-text-primary text-sm font-bold tracking-wide uppercase">
            Banking
          </h2>
        </div>
        <div className="px-5 py-4">
          {application.bank_account ? (
            <>
              <DetailRow label="Bank">
                {application.bank_account.bank_name}{" "}
                <span className="text-text-muted">
                  ({application.bank_account.bank_code})
                </span>
              </DetailRow>
              <DetailRow label="Account Holder">
                {application.bank_account.account_holder}
              </DetailRow>
              {/* Last 4 only. No surface in this application ever renders or
                  returns the full number. */}
              <DetailRow label="Account Number">
                •••• {application.bank_account.account_number_last4}
              </DetailRow>
              <DetailRow label="Status">
                {BANK_STATUS_LABELS[application.bank_account.status] ??
                  application.bank_account.status}
                {application.bank_account.rejection_reason && (
                  <span className="text-text-muted">
                    {" "}
                    — {application.bank_account.rejection_reason}
                  </span>
                )}
              </DetailRow>
            </>
          ) : (
            <p className="font-lato text-text-muted text-sm">
              No bank account on file.
            </p>
          )}
        </div>
      </section>

      {/* Verification documents (KYB) */}
      <section className="card mb-4 overflow-hidden">
        <div className="border-border bg-bg-raised border-b px-5 py-3">
          <h2 className="font-cinzel text-text-primary text-sm font-bold tracking-wide uppercase">
            Verification Documents
          </h2>
        </div>
        <div className="px-5 py-4">
          <DetailRow label="Entity Type">
            {application.entity_type ? (
              (ENTITY_LABELS[application.entity_type] ??
              application.entity_type)
            ) : (
              <span className="text-text-muted">—</span>
            )}
          </DetailRow>
          <DetailRow label="Registration No.">
            {application.registration_number ?? (
              <span className="text-text-muted">—</span>
            )}
          </DetailRow>
          <DetailRow label="Documents">
            {application.documents.length === 0 ? (
              <span className="text-text-muted">
                No documents were submitted.
              </span>
            ) : (
              <div className="flex flex-col gap-1">
                {application.documents.map((doc) => (
                  <span key={doc.id}>
                    <span className="text-text-muted">
                      {DOC_LABELS[doc.doc_type] ?? doc.doc_type}:
                    </span>{" "}
                    {doc.url ? (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gold-bright break-all hover:underline"
                      >
                        {doc.original_filename ?? "View document"}
                      </a>
                    ) : (
                      <span className="text-danger">
                        {doc.original_filename ?? "Document"} — link unavailable
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </DetailRow>
          <p className="font-lato text-text-muted mt-3 text-xs">
            Document links expire 5 minutes after this page was loaded. Reload
            to get fresh ones.
          </p>
        </div>
      </section>

      {/* Past tournament references */}
      <section className="card mb-4 overflow-hidden">
        <div className="border-border bg-bg-raised border-b px-5 py-3">
          <h2 className="font-cinzel text-text-primary text-sm font-bold tracking-wide uppercase">
            Past Tournament References
          </h2>
        </div>
        <div className="px-5 py-4">
          {application.past_tournament_refs ? (
            <p className="font-lato text-text-primary text-sm leading-relaxed whitespace-pre-wrap">
              {application.past_tournament_refs}
            </p>
          ) : (
            <p className="font-lato text-text-muted text-sm">
              No tournament references provided.
            </p>
          )}
        </div>
      </section>

      {/* Applicant account info */}
      <section className="card mb-4 overflow-hidden">
        <div className="border-border bg-bg-raised border-b px-5 py-3">
          <h2 className="font-cinzel text-text-primary text-sm font-bold tracking-wide uppercase">
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
                    {profile.fide_name_verified === false && (
                      <span
                        className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold text-amber-500"
                        title={
                          profile.fide_verified_name
                            ? `FIDE lists this ID as "${profile.fide_verified_name}"`
                            : undefined
                        }
                      >
                        ⚠ FIDE name mismatch
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-text-muted">No player profile</span>
                )}
              </DetailRow>
            </>
          ) : (
            <p className="font-lato text-text-muted text-sm">
              Applicant information not available.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
