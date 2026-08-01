import Link from "next/link";
import type { Tournament } from "../types";
import { formatRm, getMinFeeCents } from "../utils";
import { formatCalendarDateRange, resolveTimeZone } from "@/lib/datetime";

function capitalise(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

interface Props {
  tournament: Tournament;
  dimmed?: boolean;
}

export default function TournamentCard({
  tournament: t,
  dimmed = false,
}: Props) {
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
  } else if (spotsRatio <= 0.2 || spotsLeft <= 5) {
    spotsClass = "spots-low";
  }

  return (
    <article className={`card tournament-card ${dimmed ? "opacity-50" : ""}`}>
      {/* Body */}
      <div className="flex h-full flex-col p-4">
        {/* Format + rating + spots badges */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          <span className="badge-format">{capitalise(formatType) || "—"}</span>
          {t.is_fide_rated && <span className="badge-fide">FIDE</span>}
          {t.is_mcf_rated && <span className="badge-mcf">MCF</span>}
          {!t.is_fide_rated && !t.is_mcf_rated && (
            <span className="badge-unrated">Unrated</span>
          )}
          <span className={`spots ${spotsClass}`}>{spotsLabel}</span>
        </div>

        {/* Title */}
        <h3 className="font-cinzel text-text-primary mb-2 text-sm leading-tight font-semibold">
          {t.name}
        </h3>

        {/* Meta */}
        <div className="text-text-secondary font-lato mb-3 flex flex-col gap-1 text-sm">
          <span className="flex items-baseline gap-1.5">
            <span className="w-4 shrink-0 text-center">📅</span>
            <span>
              {formatCalendarDateRange(
                t.start_date,
                t.end_date,
                resolveTimeZone(t.timezone),
              )}
            </span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="w-4 shrink-0 text-center">📍</span>
            <span>
              {t.venue.name}, {t.venue.state}
            </span>
          </span>
          {timeBase !== undefined ? (
            <span className="flex items-baseline gap-1.5">
              <span className="w-4 shrink-0 text-center">⏱️</span>
              <span>
                {timeBase} min{timeInc ? ` + ${timeInc} sec` : ""}
              </span>
            </span>
          ) : null}
          {rounds !== undefined ? (
            <span className="flex items-baseline gap-1.5">
              <span className="w-4 shrink-0 text-center">🥊</span>
              <span>{rounds} rounds</span>
            </span>
          ) : null}
        </div>

        {/* Footer: price + CTA */}
        <div className="border-border mt-auto flex items-center justify-between border-t pt-3">
          <div>
            {hasMultipleFees && (
              <small className="text-text-muted font-lato ml-1 text-xs">
                starting from{" "}
              </small>
            )}
            <span className="font-cinzel text-text-primary text-lg font-bold">
              {minFee > 0 ? formatRm(minFee) : "Free"}
            </span>
          </div>

          <Link href={`/tournaments/${t.slug}`} className="card-btn-view">
            View →
          </Link>
        </div>
      </div>
    </article>
  );
}
