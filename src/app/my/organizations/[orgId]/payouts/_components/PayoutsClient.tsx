import Link from "next/link";
import EarlyPayoutRequest from "./EarlyPayoutRequest";

export interface PayoutTournament {
  tournament_id: string;
  name: string;
  status: string;
  organizer: string | null;
  recipient: {
    organization_id: string | null;
    name: string | null;
    problem: string | null;
  };
  is_beneficiary: boolean;
  net_revenue_cents: number;
  paid_payouts_cents: number;
  available_cents: number;
  early_requests_used: number;
  /** Null on a tournament this org only receives as beneficiary. */
  early_payout: { cap_cents: number; blocked: string | null } | null;
}

export interface PayoutHistoryItem {
  id: string;
  tournament_id: string;
  tournament_name: string | null;
  kind: "automatic" | "early";
  amount_cents: number;
  status: "pending" | "processing" | "paid" | "failed";
  approval: "pending" | "approved" | "rejected";
  /** The organizer's reason, for an early request. */
  reason: string | null;
  rejection_reason: string | null;
  failure_reason: string | null;
  receipt_url: string | null;
  requested_at: string;
  processed_at: string | null;
  is_beneficiary: boolean;
}

export interface PayoutsData {
  tournaments: PayoutTournament[];
  payouts: PayoutHistoryItem[];
  /** Whether this viewer holds payout.request (owners). */
  can_request_early_payout: boolean;
}

const STATUS_CONFIG: Record<
  PayoutHistoryItem["status"],
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  processing: {
    label: "Processing",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  paid: {
    label: "Paid",
    className: "bg-success/10 text-success border border-success/20",
  },
  failed: {
    label: "Failed",
    className: "bg-danger/15 text-danger border border-danger/20",
  },
};

function formatCents(cents: number): string {
  return `MYR ${(cents / 100).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatInstant(iso: string): string {
  return new Date(iso).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-lato text-text-muted text-xs tracking-widest uppercase">
        {label}
      </p>
      <p className="font-cinzel text-text-primary mt-1 text-sm font-bold">
        {value}
      </p>
    </div>
  );
}

function TournamentCard({
  tournament: t,
  orgId,
  canRequest,
}: {
  tournament: PayoutTournament;
  orgId: string;
  canRequest: boolean;
}) {
  return (
    <div className="card flex flex-col gap-3 px-5 py-4">
      <div>
        <h3 className="font-lato text-text-primary text-sm font-semibold">
          {t.name}
        </h3>
        {t.is_beneficiary ? (
          <p className="font-lato text-text-muted mt-0.5 text-xs">
            Organized by {t.organizer ?? "another organization"}. This
            organization receives the payout.
          </p>
        ) : (
          t.recipient.organization_id !== orgId && (
            <p className="font-lato text-text-muted mt-0.5 text-xs">
              Paid to your beneficiary, {t.recipient.name ?? "another organization"}.
              Your organization remains liable for this money.
            </p>
          )
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Figure label="Net revenue" value={formatCents(t.net_revenue_cents)} />
        <Figure label="Paid out" value={formatCents(t.paid_payouts_cents)} />
        <Figure label="Available" value={formatCents(t.available_cents)} />
      </div>

      {t.available_cents === 0 && (
        <p className="font-lato text-text-muted text-xs">
          Nothing is payable for this tournament yet.
        </p>
      )}

      {t.recipient.problem && (
        <p className="font-lato text-warning text-xs">
          This payout can&apos;t be sent to {t.recipient.name ?? "the recipient"}.{" "}
          {t.recipient.problem}
        </p>
      )}

      {t.early_payout && (
        <EarlyPayoutRequest
          orgId={orgId}
          tournamentId={t.tournament_id}
          capCents={t.early_payout.cap_cents}
          requestsUsed={t.early_requests_used}
          blocked={t.early_payout.blocked}
          canRequest={canRequest}
        />
      )}
    </div>
  );
}

// An early request's review comes before its transfer, so it is labelled by the
// review until it is approved.
const AWAITING_REVIEW = {
  label: "Awaiting review",
  className: "bg-warning/15 text-warning border border-warning/20",
};
const DECLINED = {
  label: "Declined",
  className: "bg-danger/15 text-danger border border-danger/20",
};

function HistoryRow({ payout: p }: { payout: PayoutHistoryItem }) {
  const status =
    p.approval === "pending"
      ? AWAITING_REVIEW
      : p.approval === "rejected"
        ? DECLINED
        : STATUS_CONFIG[p.status];
  return (
    <div className="border-border flex flex-col gap-1 border-b px-5 py-3.5 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-lato text-text-primary text-sm font-semibold">
            {p.tournament_name ?? "Tournament"}
          </p>
          <p className="font-lato text-text-muted mt-0.5 text-xs">
            {p.kind === "early" ? "Early payout" : "Payout"}
            {p.is_beneficiary && " · as beneficiary"} ·{" "}
            {formatInstant(p.processed_at ?? p.requested_at)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-cinzel text-text-primary text-sm font-bold whitespace-nowrap">
            {formatCents(p.amount_cents)}
          </span>
          <span
            className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest whitespace-nowrap uppercase ${status.className}`}
          >
            {status.label}
          </span>
        </div>
      </div>
      {p.reason && (
        <p className="font-lato text-text-muted text-xs">For: {p.reason}</p>
      )}
      {p.rejection_reason && (
        <p className="font-lato text-danger text-xs">
          Declined: {p.rejection_reason}
        </p>
      )}
      {p.failure_reason && (
        <p className="font-lato text-danger text-xs">{p.failure_reason}</p>
      )}
      {p.receipt_url && (
        <a
          href={p.receipt_url}
          target="_blank"
          rel="noreferrer"
          className="font-lato text-gold-bright text-xs hover:underline"
        >
          View receipt
        </a>
      )}
    </div>
  );
}

export default function PayoutsClient({
  orgId,
  data,
}: {
  orgId: string;
  data: PayoutsData;
}) {
  const { tournaments, payouts } = data;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link
        href={`/my/organizations/${orgId}`}
        className="font-lato text-text-muted hover:text-text-primary text-xs transition-colors"
      >
        ‹ Back to dashboard
      </Link>

      <div className="mt-3 mb-6">
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          Payouts
        </h1>
        <p className="font-lato text-text-muted mt-1 text-sm">
          Your net revenue from each tournament, and what has been sent to your
          bank account.
        </p>
      </div>

      <h2 className="font-cinzel text-text-primary mb-3 text-base font-bold tracking-wide">
        By tournament
      </h2>
      {tournaments.length === 0 ? (
        <div className="card mb-8 px-5 py-12 text-center">
          <div className="mb-4 text-4xl opacity-20">♟</div>
          <p className="font-lato text-text-muted text-sm leading-relaxed">
            Nothing to show yet. Revenue appears here once a tournament is
            published and players have paid.
          </p>
        </div>
      ) : (
        <div className="mb-8 flex flex-col gap-3">
          {tournaments.map((t) => (
            <TournamentCard
              key={t.tournament_id}
              tournament={t}
              orgId={orgId}
              canRequest={data.can_request_early_payout}
            />
          ))}
        </div>
      )}

      <h2 className="font-cinzel text-text-primary mb-3 text-base font-bold tracking-wide">
        History
      </h2>
      {payouts.length === 0 ? (
        <p className="font-lato text-text-muted text-sm">No payouts yet.</p>
      ) : (
        <div className="card overflow-hidden">
          {payouts.map((p) => (
            <HistoryRow key={p.id} payout={p} />
          ))}
        </div>
      )}
    </div>
  );
}
