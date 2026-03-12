import type { TournamentDetail as TournamentDetailType, Restrictions } from "../types";

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
  const sStr = s.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
  const eStr = e.toLocaleDateString("en-MY", opts);
  return `${sStr} – ${eStr}`;
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatRm(cents: number): string {
  if (cents === 0) return "Free";
  return `RM${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function capitalise(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function getMinFeeCents(fees: TournamentDetailType["entry_fees"]): number {
  if (!fees) return 0;
  const standard = fees.standard?.amount_cents ?? 0;
  const additional = fees.additional?.map((f) => f.amount_cents) ?? [];
  return Math.min(standard, ...additional);
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
    <section className="pt-6 border-t border-(--color-border)">
      <h2 className="[font-family:var(--font-cinzel)] text-[1.125rem] font-semibold text-(--color-text-primary) tracking-[0.04em] mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="[font-family:var(--font-cinzel)] text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-(--color-text-muted)">
        {label}
      </dt>
      <dd className="[font-family:var(--font-lato)] text-[0.9375rem] text-(--color-text-body)">
        {value}
      </dd>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

interface Props {
  tournament: TournamentDetailType;
}

export default function TournamentDetail({ tournament: t }: Props) {
  const spotsLeft = t.max_participants - t.current_participants;
  const spotsRatio = t.max_participants > 0 ? spotsLeft / t.max_participants : 0;
  const minFee = getMinFeeCents(t.entry_fees);
  const lowestFeeEntry =
    t.entry_fees.additional?.find((f) => f.amount_cents === minFee) ?? null;

  let spotsClass = "text-(--color-gold-bright)";
  if (spotsLeft === 0) spotsClass = "text-red-500";
  else if (spotsRatio <= 0.2) spotsClass = "text-amber-400";

  const orgLinks =
    t.organizer?.links && Array.isArray(t.organizer.links)
      ? (t.organizer.links as Array<{ url: string; label: string }>)
      : [];

  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <main className="max-w-[75rem] mx-auto px-6 md:px-10 py-8">
        {/* Two-column layout */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_340px] gap-8 items-start">

          {/* ── Left: scrollable detail ── */}
          <div className="flex flex-col gap-6">

            {/* Header */}
            <div>
              <h1 className="[font-family:var(--font-cinzel)] text-[1.75rem] font-semibold text-(--color-text-primary) tracking-[0.05em] leading-[1.2] mb-2">
                {t.name}
              </h1>
              {t.organizer && (
                <p className="[font-family:var(--font-lato)] text-[0.875rem] text-(--color-text-secondary)">
                  Organized by{" "}
                  <span className="text-(--color-gold-bright)">
                    {t.organizer.organization_name}
                  </span>
                </p>
              )}
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-2">
              <span className="badge badge--neutral">
                {capitalise(t.format?.type ?? "") || "—"}
              </span>
              {t.is_fide_rated && (
                <span className="badge badge--gold">FIDE Rated</span>
              )}
              {t.is_mcf_rated && (
                <span className="badge badge--gold">MCF Rated</span>
              )}
              {!t.is_fide_rated && !t.is_mcf_rated && (
                <span className="badge badge--neutral">Unrated</span>
              )}
              {(!t.restrictions || !hasRestrictions(t.restrictions)) && (
                <span className="badge badge--neutral">Open to All</span>
              )}
            </div>

            {/* Tournament Details */}
            <Section title="Tournament Details">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InfoRow
                  label="Date"
                  value={formatDateRange(t.start_date, t.end_date)}
                />
                <InfoRow
                  label="Venue"
                  value={
                    <>
                      {t.venue_name}, {t.state}
                      {t.venue_address && (
                        <span className="block text-[0.8125rem] text-(--color-text-muted) mt-0.5">
                          {t.venue_address}
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
                        {fee.type}
                        {fee.valid_until && (
                          <span className="block text-[0.75rem] text-(--color-text-muted)">
                            before {formatDeadline(fee.valid_until)}
                          </span>
                        )}
                        {(fee.age_min != null || fee.age_max != null) && (
                          <span className="block text-[0.75rem] text-(--color-text-muted)">
                            {fee.age_min != null && fee.age_max != null
                              ? `Age ${fee.age_min}–${fee.age_max}`
                              : fee.age_min != null
                                ? `Age ${fee.age_min}+`
                                : `Age up to ${fee.age_max}`}
                          </span>
                        )}
                      </td>
                      <td className="text-right [font-family:var(--font-cinzel)] font-semibold text-(--color-text-primary)">
                        {formatRm(fee.amount_cents)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>Standard</td>
                    <td className="text-right [font-family:var(--font-cinzel)] font-semibold text-(--color-text-primary)">
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
                      <p className="[font-family:var(--font-cinzel)] text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-(--color-gold-muted) mb-2">
                        {cat.name}
                      </p>
                      <ul className="flex flex-col gap-1">
                        {cat.entries.map((entry, ei) => (
                          <li
                            key={ei}
                            className="flex justify-between [font-family:var(--font-lato)] text-[0.9375rem] text-(--color-text-body)"
                          >
                            <span>{entry.place}</span>
                            <span className="[font-family:var(--font-cinzel)] font-semibold text-(--color-text-primary)">
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
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <p className="[font-family:var(--font-lato)] text-[0.9375rem] text-(--color-text-body)">
                    Open to all players — no rating or age restrictions apply.
                  </p>
                )}
              </Section>
            )}

            {/* Description */}
            {t.description && (
              <Section title="Description">
                <p className="[font-family:var(--font-lato)] text-[0.9375rem] text-(--color-text-body) leading-[1.75]">
                  {t.description}
                </p>
              </Section>
            )}

            {/* Organizer */}
            {t.organizer && (
              <Section title="Organizer">
                <div className="flex flex-col gap-3">
                  <h3 className="[font-family:var(--font-cinzel)] text-[1rem] font-semibold text-(--color-text-primary)">
                    {t.organizer.organization_name}
                  </h3>
                  {t.organizer.description && (
                    <p className="[font-family:var(--font-lato)] text-[0.9375rem] text-(--color-text-body) leading-[1.7]">
                      {t.organizer.description}
                    </p>
                  )}
                  <div className="flex flex-col gap-1 [font-family:var(--font-lato)] text-[0.875rem] text-(--color-text-secondary)">
                    <a
                      href={`mailto:${t.organizer.email}`}
                      className="hover:text-(--color-gold-bright) transition-colors"
                    >
                      ✉ {t.organizer.email}
                    </a>
                    {t.organizer.phone && (
                      <a
                        href={`tel:${t.organizer.phone}`}
                        className="hover:text-(--color-gold-bright) transition-colors"
                      >
                        ☎ {t.organizer.phone}
                      </a>
                    )}
                    {orgLinks.map((link, i) => (
                      <a
                        key={i}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-(--color-gold-bright) transition-colors"
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
            <div className="card card--featured p-6 flex flex-col gap-4">
              <h3 className="[font-family:var(--font-cinzel)] text-[1rem] font-semibold text-(--color-text-primary) tracking-[0.05em]">
                Register for this tournament
              </h3>

              {/* Price */}
              <div>
                <div className="[font-family:var(--font-cinzel)] text-[2rem] font-bold text-(--color-text-primary)">
                  {minFee > 0 ? formatRm(minFee) : "Free"}
                </div>
                {lowestFeeEntry && (
                  <p className="[font-family:var(--font-lato)] text-[0.8125rem] text-(--color-text-muted) mt-0.5">
                    {lowestFeeEntry.type} price
                    {lowestFeeEntry.valid_until &&
                      ` (ends ${formatDeadline(lowestFeeEntry.valid_until)})`}
                  </p>
                )}
              </div>

              {/* CTA */}
              {spotsLeft > 0 ? (
                <button className="btn-primary w-full">Register Now</button>
              ) : (
                <button className="btn-primary w-full opacity-50" disabled>
                  Full
                </button>
              )}

              {/* Spots */}
              <div className="[font-family:var(--font-lato)] text-[0.875rem] text-(--color-text-secondary)">
                <span className={`font-semibold ${spotsClass}`}>
                  {spotsLeft}
                </span>{" "}
                of {t.max_participants} spots remaining
              </div>

              {/* Deadline */}
              <p className="[font-family:var(--font-lato)] text-[0.8125rem] text-(--color-text-muted)">
                ⏰ Registration closes {formatDeadline(t.registration_deadline)}
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
