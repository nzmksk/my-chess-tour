import Link from "next/link";
import type { Tournament } from "../types";

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
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

function getMinFeeCents(fees: Tournament["entry_fees"]): number {
  if (!fees) return 0;
  const standard = fees.standard?.amount_cents ?? 0;
  const additional = fees.additional?.map((f) => f.amount_cents) ?? [];
  return Math.min(standard, ...additional);
}

function formatRm(cents: number): string {
  return `RM${(cents / 100).toFixed(0)}`;
}

function capitalise(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

interface Props {
  tournament: Tournament;
}

export default function TournamentCard({ tournament: t }: Props) {
  const spotsLeft = t.max_participants - t.current_participants;
  const spotsRatio =
    t.max_participants > 0 ? spotsLeft / t.max_participants : 0;
  const minFee = getMinFeeCents(t.entry_fees);
  const hasMultipleFees = (t.entry_fees?.additional?.length ?? 0) > 0;

  const formatType = t.format?.type ?? "";
  const rounds = t.format?.rounds;
  const timeBase = t.time_control?.base_minutes;
  const timeInc = t.time_control?.increment_seconds;

  let spotsLabel = `${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} left`;
  let spotsClass = "spots-available";

  if (spotsLeft === 0) {
    spotsLabel = "Full";
    spotsClass = "spots-full";
  } else if (spotsRatio <= 0.2) {
    spotsClass = "spots-low";
  }

  return (
    <article className="tournament-card">
      {/* Body */}
      <div className="p-4 flex flex-col justify-center">
        {/* Format + rating + spots badges */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className="badge-format">{capitalise(formatType) || "—"}</span>
          {t.is_fide_rated && <span className="badge-fide">FIDE</span>}
          {t.is_mcf_rated && <span className="badge-mcf">MCF</span>}
          {!t.is_fide_rated && !t.is_mcf_rated && (
            <span className="badge-unrated">Unrated</span>
          )}
          <span
            className={`text-[0.6875rem] [font-family:var(--font-lato)] font-semibold py-0.75 px-2 rounded-xs ${spotsClass}`}
          >
            {spotsLabel}
          </span>
        </div>

        {/* Title */}
        <h3 className="[font-family:var(--font-cinzel)] text-[0.9375rem] font-semibold text-(--color-text-primary) mb-2 leading-[1.3]">
          {t.name}
        </h3>

        {/* Meta */}
        <div className="flex flex-col gap-1 text-[0.8125rem] text-(--color-text-secondary) [font-family:var(--font-lato)] mb-3">
          <span>📅 {formatDateRange(t.start_date, t.end_date)}</span>
          <span>
            📍 {t.venue_name}, {t.state}
          </span>
          {timeBase !== undefined ? (
            <span>
              ⏱ {timeBase} min{timeInc ? ` + ${timeInc} sec` : ""}
              {rounds ? ` · ${rounds} rounds` : ""}
            </span>
          ) : rounds ? (
            <span>♟ Swiss · {rounds} rounds</span>
          ) : null}
        </div>

        {/* Footer: price + CTA */}
        <div className="flex justify-between items-center pt-3 border-t border-(--color-border)">
          <div>
            {hasMultipleFees && (
              <small className="text-xs text-(--color-text-muted) [font-family:var(--font-lato)] ml-1">
                starting from{" "}
              </small>
            )}
            <span className="[font-family:var(--font-cinzel)] text-[1.125rem] font-bold text-(--color-text-primary)">
              {minFee > 0 ? formatRm(minFee) : "Free"}
            </span>
          </div>

          {spotsLeft === 0 ? (
            <button className="card-btn-full" disabled>
              Full
            </button>
          ) : (
            <Link href={`/tournaments/${t.id}`} className="card-btn-view">
              View →
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
