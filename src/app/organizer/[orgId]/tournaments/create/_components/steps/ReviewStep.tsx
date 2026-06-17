"use client";

import React from "react";
import { useTournamentWizard } from "../TournamentWizardContext";
import type { FeeTier, TierType } from "../TournamentWizardContext";

const COMMISSION = 0.1;

function fmtRM(val: number): string {
  return `RM ${val.toFixed(2)}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TIER_LABELS: Record<TierType, string> = {
  "early-bird": "Early Bird",
  titled: "Titled Players",
  "rating-based": "Rating-Based",
  "age-based": "Age-Based",
};

function tierSubLabel(tier: FeeTier): string {
  switch (tier.type) {
    case "early-bird":
      return tier.validUntil ? `until ${fmtDate(tier.validUntil)}` : "";
    case "titled":
      return tier.titles.length > 0 ? tier.titles.join(", ") : "";
    case "rating-based":
      if (tier.ratingFrom !== "" && tier.ratingTo !== "") {
        return `${tier.ratingFrom}–${tier.ratingTo}`;
      }
      return "";
    case "age-based":
      if (tier.ageFrom !== "" && tier.ageTo !== "") {
        return `${tier.ageFrom}–${tier.ageTo} yrs`;
      }
      return "";
  }
}

function SectionCard({
  title,
  onEdit,
  children,
  last,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-bg-base p-5 ${last ? "" : "mb-4"}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-cinzel text-sm font-semibold text-text-primary">
          {title}
        </h3>
        <button
          type="button"
          className="font-lato border-border text-text-muted hover:border-gold-muted hover:text-text-primary cursor-pointer rounded-md border bg-transparent px-3 py-1 text-xs transition duration-200"
          onClick={onEdit}
        >
          Edit
        </button>
      </div>
      {children}
    </div>
  );
}

function InfoGrid({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div
      className="font-lato text-sm text-text-muted"
      style={{
        display: "grid",
        gridTemplateColumns: "130px 1fr",
        gap: "6px 16px",
      }}
    >
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <span className="text-text-disabled">{label}</span>
          <span className="text-text-muted">{value || "—"}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

export default function ReviewStep() {
  const { basicInfoData, formatData, feesData, prizesData, goToStep } =
    useTournamentWizard();

  // ── Basic Info ────────────────────────────────────────────

  const basicRows: [string, React.ReactNode][] = [
    ["Name", basicInfoData.name || "—"],
    ...(basicInfoData.description
      ? ([["Description", basicInfoData.description]] as [string, React.ReactNode][])
      : []),
    ["Venue", basicInfoData.venueName || "—"],
    ["State", basicInfoData.venueState || "—"],
    ["Address", basicInfoData.venueAddress || "—"],
  ];

  // ── Format & Schedule ─────────────────────────────────────

  const formatSummary = [formatData.formatType, formatData.system, formatData.rounds ? `${formatData.rounds} rounds` : ""]
    .filter(Boolean)
    .join(" · ");

  const timeControl = (() => {
    const parts: string[] = [];
    if (formatData.baseTime !== "") parts.push(`${formatData.baseTime} min`);
    if (formatData.increment) parts.push(`${formatData.increment} sec increment`);
    if (formatData.delay) parts.push(`${formatData.delay} sec delay`);
    return parts.join(" + ") || "—";
  })();

  const dates = (() => {
    const start = fmtDate(formatData.startDate);
    const end = fmtDate(formatData.endDate);
    if (!formatData.startDate) return "—";
    if (formatData.startDate === formatData.endDate || !formatData.endDate) return start;
    return `${start} – ${end}`;
  })();

  const ratingLabels = [
    formatData.fideRated ? "FIDE Rated" : null,
    formatData.mcfRated ? "MCF Rated" : null,
  ]
    .filter(Boolean)
    .join(", ") || "Unrated";

  const restrictionsSummary = formatData.restrictions.length > 0
    ? formatData.restrictions.map((r) => `${r.type} ${r.value}`).join(", ")
    : null;

  const formatRows: [string, React.ReactNode][] = [
    ["Format", formatSummary || "—"],
    ["Time Control", timeControl],
    ["Dates", dates],
    ["Deadline", fmtDateTime(formatData.registrationDeadline)],
    ["Capacity", formatData.maxParticipants ? `${formatData.maxParticipants} players` : "—"],
    ["Rating", ratingLabels],
    ...(restrictionsSummary
      ? ([["Restrictions", restrictionsSummary]] as [string, React.ReactNode][])
      : []),
  ];

  // ── Entry Fees ────────────────────────────────────────────

  const stdFee = Number(feesData.standardFee) || 0;
  const allTiers = [
    { id: "standard", label: "Standard", subLabel: "", organiserFee: stdFee },
    ...feesData.tiers.map((t) => ({
      id: t.id,
      label: TIER_LABELS[t.type],
      subLabel: tierSubLabel(t),
      organiserFee: Number(t.amount) || 0,
    })),
  ];

  // ── Prizes ────────────────────────────────────────────────

  const hasCategories = prizesData.categories.length > 0;
  const hasSpecialPrizes = prizesData.specialPrizes.length > 0;

  return (
    <div>
      <h2 className="font-cinzel mb-1 text-lg font-bold text-text-primary tracking-wide">
        Review &amp; Publish
      </h2>
      <p className="font-lato mb-6 text-sm text-text-muted">
        Review your tournament details before publishing or saving as a draft.
      </p>

      {/* Basic Information */}
      <SectionCard title="Basic Information" onEdit={() => goToStep(0)}>
        <InfoGrid rows={basicRows} />
      </SectionCard>

      {/* Format & Schedule */}
      <SectionCard title="Format &amp; Schedule" onEdit={() => goToStep(1)}>
        <InfoGrid rows={formatRows} />
      </SectionCard>

      {/* Entry Fees */}
      <SectionCard title="Entry Fees" onEdit={() => goToStep(2)}>
        <div
          className="font-lato text-sm text-text-muted"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: "4px 16px",
            alignItems: "center",
          }}
        >
          {/* Header row */}
          <span className="text-xs font-semibold uppercase tracking-wide text-text-disabled">
            Tier
          </span>
          <span className="text-right text-xs font-semibold uppercase tracking-wide text-text-disabled">
            Your Revenue
          </span>
          <span className="text-right text-xs font-semibold uppercase tracking-wide text-text-disabled">
            Player Pays
          </span>

          {/* Data rows */}
          {allTiers.map((tier) => {
            const playerPays = tier.organiserFee * (1 + COMMISSION);
            const isFree = tier.organiserFee === 0;
            return (
              <React.Fragment key={tier.id}>
                <span>
                  {tier.label}
                  {tier.subLabel && (
                    <span className="ml-1.5 text-xs text-text-disabled">
                      ({tier.subLabel})
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-right font-mono">
                  {fmtRM(tier.organiserFee)}
                </span>
                <span
                  className={`tabular-nums text-right font-mono font-semibold ${isFree ? "text-text-muted" : "text-gold-bright"}`}
                >
                  {isFree ? "Free" : fmtRM(playerPays)}
                </span>
              </React.Fragment>
            );
          })}
        </div>
        <p className="font-lato mt-2 text-xs text-text-disabled">
          10% platform commission is added to your fee and charged to the player.
        </p>
      </SectionCard>

      {/* Prizes */}
      <SectionCard title="Prizes" onEdit={() => goToStep(3)} last>
        <div className="font-lato text-sm text-text-muted">
          {!hasCategories && !hasSpecialPrizes && (
            <p className="text-text-disabled">No prizes defined.</p>
          )}

          {hasCategories &&
            prizesData.categories.map((cat, catIdx) => (
              <div key={cat.id} className={catIdx > 0 ? "mt-4" : ""}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-text-disabled">
                  {cat.name || "Unnamed Category"}
                </p>
                {cat.prizes.map((row) => (
                  <div
                    key={row.id}
                    className="flex justify-between py-0.5"
                  >
                    <span>{row.placement}</span>
                    <span className="tabular-nums font-mono">
                      {row.amount !== "" ? fmtRM(Number(row.amount)) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            ))}

          {hasSpecialPrizes && (
            <div className={hasCategories ? "mt-4" : ""}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-text-disabled">
                Special
              </p>
              {prizesData.specialPrizes.map((sp) => (
                <div key={sp.id} className="flex justify-between py-0.5">
                  <span>{sp.name}</span>
                  <span className="tabular-nums font-mono">
                    {sp.amount !== "" ? fmtRM(Number(sp.amount)) : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
