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
  const sStr = s.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
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
  const spotsRatio = t.max_participants > 0 ? spotsLeft / t.max_participants : 0;
  const minFee = getMinFeeCents(t.entry_fees);
  const hasMultipleFees = (t.entry_fees?.additional?.length ?? 0) > 0;

  const formatType = t.format?.type ?? "";
  const rounds = t.format?.rounds;
  const timeBase = t.time_control?.base_minutes;
  const timeInc = t.time_control?.increment_seconds;

  let spotsLabel = `${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} left`;
  let spotsBg = "rgba(201,168,76,0.10)";
  let spotsColor = "var(--color-gold-bright)";

  if (spotsLeft === 0) {
    spotsLabel = "Full";
    spotsBg = "rgba(180,60,50,0.15)";
    spotsColor = "#c05040";
  } else if (spotsRatio <= 0.2) {
    spotsBg = "rgba(200,130,40,0.15)";
    spotsColor = "#c8883a";
  }

  return (
    <article className="tournament-card">
      {/* Poster */}
      <div
        style={{
          background: "var(--color-bg-raised)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "200px",
          position: "relative",
          flexShrink: 0,
        }}
      >
        {t.poster_url ? (
          <img
            src={t.poster_url}
            alt={`${t.name} poster`}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span
            style={{
              fontSize: "32px",
              color: "var(--color-gold-dim)",
            }}
          >
            ♟
          </span>
        )}

        <span
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            fontSize: "11px",
            fontFamily: "var(--font-lato)",
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: "2px",
            background: spotsBg,
            color: spotsColor,
          }}
        >
          {spotsLabel}
        </span>
      </div>

      {/* Body */}
      <div
        style={{
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {/* Format + rating badges */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            marginBottom: "8px",
          }}
        >
          <span className="badge-format">{capitalise(formatType) || "—"}</span>
          {t.is_fide_rated && <span className="badge-fide">FIDE</span>}
          {t.is_mcf_rated && <span className="badge-mcf">MCF</span>}
          {!t.is_fide_rated && !t.is_mcf_rated && (
            <span className="badge-unrated">Unrated</span>
          )}
        </div>

        {/* Title */}
        <h3
          style={{
            fontFamily: "var(--font-cinzel)",
            fontSize: "15px",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            marginBottom: "8px",
            lineHeight: "1.3",
          }}
        >
          {t.name}
        </h3>

        {/* Meta */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
            fontFamily: "var(--font-lato)",
            marginBottom: "12px",
          }}
        >
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: "12px",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <div>
            {hasMultipleFees && (
              <small
                style={{
                  fontSize: "12px",
                  color: "var(--color-text-muted)",
                  fontFamily: "var(--font-lato)",
                  marginLeft: "4px",
                }}
              >
                Starting from {" "}
              </small>
            )}
            <span
              style={{
                fontFamily: "var(--font-cinzel)",
                fontSize: "18px",
                fontWeight: 700,
                color: "var(--color-text-primary)",
              }}
            >
              {minFee > 0 ? formatRm(minFee) : "Free"}
            </span>
          </div>

          <button
            className={spotsLeft === 0 ? "card-btn-full" : "card-btn-view"}
            disabled={spotsLeft === 0}
          >
            {spotsLeft === 0 ? "Full" : "View →"}
          </button>
        </div>
      </div>
    </article>
  );
}
