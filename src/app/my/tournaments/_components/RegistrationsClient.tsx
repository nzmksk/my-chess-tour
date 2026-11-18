"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { PlayerRegistration, RegistrationStatus } from "../types";
import type { TournamentFormat, TimeControl } from "@/app/tournaments/types";
import { formatRinggit } from "@/services/payouts/format";
import { formatInstantDate } from "@/lib/tournaments/datetime";
import { SUPPORT_EMAIL } from "@/lib/reference/contact";
import { classifyRegistration, type RegistrationTab as Tab } from "../classify";

interface Props {
  registrations: PlayerRegistration[];
}

function formatTimeControl(tc: TimeControl): string {
  return `${tc.base_minutes}+${tc.increment_seconds}`;
}

function formatTournamentType(format: TournamentFormat): string {
  return format.type.charAt(0).toUpperCase() + format.type.slice(1);
}

function StatusBadge({
  status,
  tournamentCancelled,
}: {
  status: RegistrationStatus;
  tournamentCancelled: boolean;
}) {
  const config: Record<
    RegistrationStatus,
    { label: string; className: string }
  > = {
    confirmed: {
      label: "Confirmed",
      className: "bg-success/10 text-success border border-success/20",
    },
    pending_payment: {
      label: "Pending Payment",
      className: "bg-warning/15 text-warning border border-warning/20",
    },
    failed_payment: {
      label: "Payment Failed",
      className: "bg-danger/15 text-danger border border-danger/20",
    },
    cancelled_payment: {
      label: "Cancelled",
      className: "bg-bg-raised text-text-muted border border-border",
    },
    forfeited: {
      label: "Forfeited",
      className: "bg-bg-raised text-text-muted border border-border",
    },
  };

  const { label, className } = tournamentCancelled
    ? {
        label: "Tournament Cancelled",
        className: "bg-bg-raised text-text-muted border border-border",
      }
    : (config[status] ?? config.cancelled_payment);

  return (
    <span
      className={`font-cinzel text-xs font-bold tracking-widest uppercase px-2.5 py-1 rounded-md whitespace-nowrap ${className}`}
    >
      {label}
    </span>
  );
}

// Where the refund for a cancelled tournament stands, so the player can follow
// the money the cancellation email promised (#511).
function RefundLine({
  refund,
}: {
  refund: NonNullable<PlayerRegistration["refund"]>;
}) {
  const amount = formatRinggit(refund.amount_cents);

  if (refund.state === "refunded") {
    return (
      <p className="font-lato text-xs text-success mt-1">
        Refunded {amount}
        {refund.processed_at && ` on ${formatInstantDate(refund.processed_at)}`}
      </p>
    );
  }

  if (refund.state === "failed") {
    return (
      <p className="font-lato text-xs text-danger mt-1">
        Refund of {amount} could not be completed. Contact {SUPPORT_EMAIL} and
        we will arrange it.
      </p>
    );
  }

  return (
    <p className="font-lato text-xs text-warning mt-1">
      Refund of {amount} processing
    </p>
  );
}

interface RegistrationCardProps {
  registration: PlayerRegistration;
  dimmed?: boolean;
}

function RegistrationCard({ registration, dimmed }: RegistrationCardProps) {
  const { tournament, status } = registration;
  const startDate = new Date(tournament.start_date + "T00:00:00");
  const month = startDate
    .toLocaleString("en-MY", { month: "short" })
    .toUpperCase();
  const day = startDate.getDate();
  const format = tournament.format as TournamentFormat;
  const tc = tournament.time_control as TimeControl;

  return (
    <Link
      href={`/tournaments/${tournament.slug}`}
      className={`flex items-center gap-4 card px-5 py-4 no-underline transition-shadow duration-150 hover:shadow-[0_4px_20px_var(--color-grandiose-hover)] ${dimmed ? "opacity-60" : ""}`}
    >
      {/* Date block */}
      <div className="text-center min-w-12 shrink-0">
        <div className="font-cinzel text-xs font-bold tracking-widest text-gold-bright">
          {month}
        </div>
        <div className="font-cinzel text-2xl font-bold text-text-primary leading-tight">
          {day}
        </div>
      </div>

      {/* Tournament info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-lato text-text-primary truncate text-sm font-semibold">
          {tournament.name}
        </h4>
        <p className="font-lato text-xs text-text-muted mt-0.5">
          {tournament.venue_name}
          {format && tc && (
            <>
              {" · "}
              {formatTournamentType(format)}
              {" · "}
              {formatTimeControl(tc)}
            </>
          )}
        </p>
        {registration.refund && <RefundLine refund={registration.refund} />}
      </div>

      {/* Status badge */}
      <StatusBadge
        status={status}
        tournamentCancelled={tournament.status === "cancelled"}
      />
    </Link>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const messages: Record<Tab, string> = {
    ongoing: "No tournaments in progress right now.",
    upcoming:
      "No upcoming tournaments. Browse available tournaments to register.",
    past: "No past tournaments yet.",
    cancelled: "No cancelled registrations or tournaments.",
  };

  return (
    <div className="text-center py-16 px-5">
      <div className="text-4xl mb-4 opacity-20">♟</div>
      <p className="font-lato text-sm text-text-muted leading-relaxed">
        {messages[tab]}
      </p>
      {tab === "upcoming" && (
        <Link
          href="/"
          className="btn-secondary mt-4 inline-block px-5 py-2 text-xs"
        >
          Browse Tournaments
        </Link>
      )}
    </div>
  );
}

export default function RegistrationsClient({ registrations }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("upcoming");

  const categorised = useMemo(() => {
    const ongoing: PlayerRegistration[] = [];
    const upcoming: PlayerRegistration[] = [];
    const past: PlayerRegistration[] = [];
    const cancelled: PlayerRegistration[] = [];

    const now = new Date();
    for (const reg of registrations) {
      const tab = classifyRegistration(reg, now);
      if (tab === "ongoing") ongoing.push(reg);
      else if (tab === "upcoming") upcoming.push(reg);
      else if (tab === "past") past.push(reg);
      else cancelled.push(reg);
    }

    // Ongoing: finishing soonest first. Upcoming: nearest start first. Past:
    // most recently finished first, by end_date, since a long event can end
    // after a later-starting short one. All stable, so ties keep the API's
    // most-recently-registered order.
    ongoing.sort((a, b) =>
      a.tournament.end_date.localeCompare(b.tournament.end_date),
    );
    upcoming.sort((a, b) =>
      a.tournament.start_date.localeCompare(b.tournament.start_date),
    );
    past.sort((a, b) =>
      b.tournament.end_date.localeCompare(a.tournament.end_date),
    );

    return { ongoing, upcoming, past, cancelled };
  }, [registrations]);

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: "ongoing", label: "Ongoing", count: categorised.ongoing.length },
    { key: "upcoming", label: "Upcoming", count: categorised.upcoming.length },
    { key: "past", label: "Past", count: categorised.past.length },
    {
      key: "cancelled",
      label: "Cancelled",
      count: categorised.cancelled.length,
    },
  ];

  const items = categorised[activeTab];

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="font-cinzel text-2xl font-bold text-text-primary tracking-wide mb-1">
        My Tournaments
      </h1>
      <p className="font-lato text-sm text-text-muted mb-6">
        Manage your registrations and view upcoming events.
      </p>

      {/* Tabs */}
      <div className="flex border-b border-border mb-5">
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`font-lato text-sm font-medium px-4 py-2.5 border-b-2 transition-colors duration-150 cursor-pointer bg-transparent ${
              activeTab === key
                ? "text-text-primary border-gold-bright"
                : "text-text-muted border-transparent hover:text-text-secondary"
            }`}
          >
            {label}
            {count > 0 && (
              <span
                className={`ml-1.5 font-cinzel text-xs font-bold px-1.5 py-0.5 rounded-full ${
                  activeTab === key
                    ? "bg-gold-ghost text-gold-bright"
                    : "bg-bg-raised text-text-muted"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Registration list */}
      {items.length === 0 ? (
        <EmptyState tab={activeTab} />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((reg) => (
            <RegistrationCard
              key={reg.id}
              registration={reg}
              dimmed={activeTab === "past"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
