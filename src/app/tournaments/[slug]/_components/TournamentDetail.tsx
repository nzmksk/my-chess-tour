import Link from "next/link";
import type {
  TournamentDetail as TournamentDetailType,
  Restrictions,
  StartingRankPlayer,
} from "../types";
import {
  formatDeadline,
  formatRm,
  getMinFeeCents,
  toTitleCase,
} from "../../utils";
import TournamentTabs from "./TournamentTabs";
import StartingRankTab from "./StartingRankTab";

// ── Formatting helpers ────────────────────────────────────────

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  };
  if (s.toDateString() === e.toDateString()) {
    return s.toLocaleDateString("en-MY", opts);
  }
  const sStr = s.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
  });
  const eStr = e.toLocaleDateString("en-MY", opts);
  return `${sStr} – ${eStr}`;
}

function capitalise(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function hasRestrictions(r: Restrictions): boolean {
  return (
    r.min_rating != null ||
    r.max_rating != null ||
    r.min_age != null ||
    r.max_age != null
  );
}

// ── Sub-sections ──────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border border-t pt-4">
      <h2 className="font-cinzel text-text-primary mb-2 text-lg font-semibold tracking-wider">
        {title}
      </h2>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-cinzel text-text-muted text-xs font-semibold tracking-widest uppercase">
        {label}
      </dt>
      <dd className="font-lato text-text-body text-sm">{value}</dd>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

interface Props {
  tournament: TournamentDetailType;
  isAuthenticated: boolean;
  registrationStatus?: string | null;
  isOrgMember?: boolean;
  canViewStartingRank: boolean;
  startingRank: StartingRankPlayer[] | null;
}

export default function TournamentDetail({
  tournament: t,
  isAuthenticated,
  registrationStatus = null,
  canViewStartingRank,
  startingRank,
}: Props) {
  const spotsLeft = t.max_participants - t.current_participants;
  const spotsRatio =
    t.max_participants > 0 ? spotsLeft / t.max_participants : 0;
  const minFee = getMinFeeCents(t.entry_fees);
  const isDeadlinePassed = new Date(t.registration_deadline) < new Date();
  const lowestFeeEntry =
    t.entry_fees.additional?.find((f) => f.amount_cents === minFee) ?? null;
  const tournamentStarted = new Date(t.start_date + "T00:00:00") <= new Date();

  let spotsClass = "text-gold-bright";
  if (spotsLeft === 0) spotsClass = "text-red-500";
  else if (spotsRatio <= 0.2) spotsClass = "text-amber-400";

  const orgLinks =
    t.organization?.links && Array.isArray(t.organization.links)
      ? (t.organization.links as Array<{ url: string; label: string }>)
      : [];

  const detailsContent = (
    <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-[1fr_340px]">
      {/* ── Left: scrollable detail ── */}
      <div className="flex flex-col gap-4">
        {/* Tournament Details */}
        <Section title="Tournament Details">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InfoRow
              label="Date"
              value={formatDateRange(t.start_date, t.end_date)}
            />
            <InfoRow
              label="Venue"
              value={
                <>
                  {t.venue.name}, {t.venue.state}
                  {t.venue.address && (
                    <span className="text-text-muted mt-0.5 block text-sm">
                      {t.venue.address}
                    </span>
                  )}
                </>
              }
            />
            <InfoRow
              label="Format"
              value={`${capitalise(t.format?.type ?? "")} — ${capitalise(t.format?.system ?? "")} System, ${t.format?.rounds} rounds`}
            />
            <InfoRow
              label="Time Control"
              value={
                t.time_control
                  ? `${t.time_control.base_minutes} min${t.time_control.increment_seconds > 0 ? ` + ${t.time_control.increment_seconds} sec` : ""}`
                  : "—"
              }
            />
            <InfoRow
              label="Registration Deadline"
              value={formatDeadline(t.registration_deadline)}
            />
            <InfoRow
              label="Capacity"
              value={
                <>
                  {t.max_participants} players{" "}
                  <span className={spotsClass}>
                    ({spotsLeft > 0 ? `${spotsLeft} spots left` : "Full"})
                  </span>
                </>
              }
            />
          </dl>
        </Section>

        {/* Entry Fees */}
        <Section title="Entry Fees">
          <table className="table w-full">
            <thead>
              <tr>
                <th className="text-left">Category</th>
                <th className="text-right">Fee</th>
              </tr>
            </thead>
            <tbody>
              {t.entry_fees.additional?.map((fee, i) => (
                <tr key={i}>
                  <td>
                    {toTitleCase(fee.type)}
                    {fee.valid_until && (
                      <span className="text-text-muted block text-xs">
                        before {formatDeadline(fee.valid_until)}
                      </span>
                    )}
                    {(fee.age_min != null || fee.age_max != null) && (
                      <span className="text-text-muted block text-xs">
                        {fee.age_min != null && fee.age_max != null
                          ? `Age ${fee.age_min}–${fee.age_max}`
                          : fee.age_min != null
                            ? `Age ${fee.age_min}+`
                            : `Age up to ${fee.age_max}`}
                      </span>
                    )}
                  </td>
                  <td className="font-cinzel text-text-primary text-right font-semibold">
                    {formatRm(fee.amount_cents)}
                  </td>
                </tr>
              ))}
              <tr>
                <td>Standard</td>
                <td className="font-cinzel text-text-primary text-right font-semibold">
                  {formatRm(t.entry_fees.standard.amount_cents)}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* Prizes */}
        {t.prizes && t.prizes.categories.length > 0 && (
          <Section title="Prizes">
            <ul className="flex flex-col gap-3">
              {t.prizes.categories.map((cat, ci) => (
                <li key={ci}>
                  <p className="font-cinzel text-gold-muted mb-2 text-xs font-semibold tracking-widest uppercase">
                    {cat.name}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {cat.entries.map((entry, ei) => (
                      <li
                        key={ei}
                        className="font-lato text-text-body flex justify-between text-sm"
                      >
                        <span>{entry.place}</span>
                        <span className="font-cinzel text-text-primary font-semibold">
                          {formatRm(entry.amount_cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Restrictions */}
        {t.restrictions && (
          <Section title="Restrictions">
            {hasRestrictions(t.restrictions) ? (
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(t.restrictions.min_rating != null ||
                  t.restrictions.max_rating != null) && (
                  <InfoRow
                    label="Rating"
                    value={
                      t.restrictions.min_rating != null &&
                      t.restrictions.max_rating != null
                        ? `${t.restrictions.min_rating} – ${t.restrictions.max_rating}`
                        : t.restrictions.min_rating != null
                          ? `${t.restrictions.min_rating}+`
                          : `Up to ${t.restrictions.max_rating}`
                    }
                  />
                )}
                {(t.restrictions.min_age != null ||
                  t.restrictions.max_age != null) && (
                  <InfoRow
                    label="Age"
                    value={
                      t.restrictions.min_age != null &&
                      t.restrictions.max_age != null
                        ? `${t.restrictions.min_age} – ${t.restrictions.max_age} years`
                        : t.restrictions.min_age != null
                          ? `${t.restrictions.min_age}+ years`
                          : `Up to ${t.restrictions.max_age} years`
                    }
                  />
                )}
              </dl>
            ) : (
              <p className="font-lato text-text-body text-sm">
                Open to all players — no rating or age restrictions apply.
              </p>
            )}
          </Section>
        )}

        {/* Description */}
        {t.description && (
          <Section title="Description">
            <p className="font-lato text-text-body text-sm leading-relaxed">
              {t.description}
            </p>
          </Section>
        )}

        {/* Organizer */}
        {t.organization && (
          <Section title={t.organization.name}>
            <div className="flex flex-col gap-1">
              {t.organization.description && (
                <p className="font-lato text-text-body text-sm leading-relaxed">
                  {t.organization.description}
                </p>
              )}
              <div className="font-lato text-text-secondary flex flex-col gap-1 text-sm">
                <a
                  href={`mailto:${t.organization.email}`}
                  className="hover:text-gold-bright transition-colors"
                >
                  ✉ {t.organization.email}
                </a>
                {t.organization.phone && (
                  <a
                    href={`tel:${t.organization.phone}`}
                    className="hover:text-gold-bright transition-colors"
                  >
                    ☎ {t.organization.phone}
                  </a>
                )}
                {orgLinks.map((link, i) => (
                  <a
                    key={i}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-gold-bright transition-colors"
                  >
                    ↗ {link.label}
                  </a>
                ))}
              </div>
            </div>
          </Section>
        )}
      </div>

      {/* ── Right: sticky register card ── */}
      <aside className="md:sticky md:top-24">
        <div className="card card--featured flex flex-col gap-4 p-6">
          <h3 className="font-cinzel text-text-primary text-lg font-semibold tracking-wider">
            Register for this tournament
          </h3>

          {/* Price */}
          <div>
            <div className="font-cinzel text-text-primary text-3xl font-bold">
              {minFee > 0 ? formatRm(minFee) : "Free"}
            </div>
            {lowestFeeEntry && (
              <p className="font-lato text-text-muted text-sm">
                {toTitleCase(lowestFeeEntry.type)} price
                {lowestFeeEntry.valid_until &&
                  ` (ends ${formatDeadline(lowestFeeEntry.valid_until)})`}
              </p>
            )}
          </div>

          {/* CTA */}
          {registrationStatus === "confirmed" ? (
            <button
              className="btn-primary w-full rounded-md opacity-50"
              disabled
            >
              Registered
            </button>
          ) : isDeadlinePassed ? (
            <button
              className="btn-primary w-full rounded-md opacity-50"
              disabled
            >
              Registration Closed
            </button>
          ) : !isAuthenticated ? (
            <button
              className="btn-primary w-full rounded-md opacity-50"
              disabled
            >
              Sign In to Register
            </button>
          ) : registrationStatus === "pending_payment" ? (
            <Link
              href={`/tournaments/${t.slug}/register`}
              className="btn-primary block w-full rounded-md text-center"
            >
              Complete Payment
            </Link>
          ) : spotsLeft === 0 ? (
            <button
              className="btn-primary w-full rounded-md opacity-50"
              disabled
            >
              Full Capacity
            </button>
          ) : (
            <Link
              href={`/tournaments/${t.slug}/register`}
              className="btn-primary block w-full rounded-md text-center"
            >
              Register Now
            </Link>
          )}

          {/* Spots */}
          <div className="font-lato text-text-secondary text-sm">
            <span className={`font-semibold ${spotsClass}`}>{spotsLeft}</span>{" "}
            of {t.max_participants} spots remaining
            {/* Deadline */}
            <p className="font-lato text-text-muted text-sm">
              ⏰ Registration closes {formatDeadline(t.registration_deadline)}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );

  const startingRankContent = (
    <StartingRankTab
      startingRank={startingRank}
      canViewStartingRank={canViewStartingRank}
      tournamentStarted={tournamentStarted}
      isAuthenticated={isAuthenticated}
    />
  );

  return (
    <div className="bg-bg-base min-h-screen">
      <main className="mx-auto max-w-300 px-6 py-8 md:px-10">
        {/* Header — always visible above tabs */}
        <div className="mb-6">
          <h1 className="font-cinzel text-text-primary text-2xl leading-tight font-semibold tracking-wider">
            {t.name}
          </h1>
          {t.organization && (
            <p className="font-lato text-text-secondary text-sm">
              Organized by{" "}
              <span className="text-gold-bright">{t.organization.name}</span>
            </p>
          )}

          {/* Badges */}
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="badge-format">
              {capitalise(t.format?.type ?? "") || "—"}
            </span>
            {t.is_fide_rated && <span className="badge-fide">FIDE Rated</span>}
            {t.is_mcf_rated && <span className="badge-mcf">MCF Rated</span>}
            {!t.is_fide_rated && !t.is_mcf_rated && (
              <span className="badge-unrated">Unrated</span>
            )}
            {(!t.restrictions || !hasRestrictions(t.restrictions)) && (
              <span className="badge-open">Open to All</span>
            )}
          </div>
        </div>

        {/* Tabbed content */}
        <TournamentTabs
          tournamentDetailsContent={detailsContent}
          startingRankContent={startingRankContent}
        />
      </main>
    </div>
  );
}
