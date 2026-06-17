"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  WIZARD_STEPS,
  useTournamentWizard,
  type FeeTier,
} from "./TournamentWizardContext";
import WizardProgressBar from "./WizardProgressBar";
import BasicInfoStep from "./steps/BasicInfoStep";
import FormatStep from "./steps/FormatStep";
import FeesStep from "./steps/FeesStep";
import PrizesStep from "./steps/PrizesStep";
import ReviewStep from "./steps/ReviewStep";

const STEP_COMPONENTS = [
  BasicInfoStep,
  FormatStep,
  FeesStep,
  PrizesStep,
  ReviewStep,
];

interface WizardShellProps {
  orgId: string;
  orgName: string;
}

function mapTierType(t: FeeTier["type"]): string {
  switch (t) {
    case "early-bird":
      return "early_bird";
    case "titled":
      return "titled_players";
    case "rating-based":
      return "rating_based";
    case "age-based":
      return "age_based";
  }
}

export default function WizardShell({ orgId, orgName }: WizardShellProps) {
  const router = useRouter();
  const {
    currentStepIndex,
    goBack,
    triggerStepHandler,
    basicInfoData,
    formatData,
    feesData,
    prizesData,
    tournamentId,
    setTournamentId,
    clearWizardStorage,
  } = useTournamentWizard();
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === WIZARD_STEPS.length - 1;

  const StepContent = STEP_COMPONENTS[currentStepIndex];

  function buildDraftBody(): Record<string, unknown> {
    const entryFees = {
      standard: {
        amount_cents:
          feesData.standardFee === ""
            ? 0
            : Math.round(Number(feesData.standardFee) * 100),
      },
      additional: feesData.tiers.map((tier) => {
        const base: Record<string, unknown> = {
          type: mapTierType(tier.type),
          amount_cents:
            tier.amount === "" ? 0 : Math.round(Number(tier.amount) * 100),
        };
        if (tier.type === "early-bird" && tier.validUntil) {
          base.valid_until = tier.validUntil;
        } else if (tier.type === "titled" && tier.titles.length > 0) {
          base.titles = tier.titles;
        } else if (tier.type === "rating-based") {
          if (tier.ratingFrom !== "") base.rating_from = tier.ratingFrom;
          if (tier.ratingTo !== "") base.rating_to = tier.ratingTo;
        } else if (tier.type === "age-based") {
          if (tier.ageFrom !== "") base.age_from = tier.ageFrom;
          if (tier.ageTo !== "") base.age_to = tier.ageTo;
        }
        return base;
      }),
    };

    const prizes =
      prizesData.categories.length > 0 || prizesData.specialPrizes.length > 0
        ? {
            categories: prizesData.categories.map((cat) => ({
              name: cat.name,
              entries: cat.prizes.map((p) => ({
                placement: p.placement,
                amount_cents:
                  p.amount === "" ? 0 : Math.round(Number(p.amount) * 100),
              })),
            })),
            special: prizesData.specialPrizes.map((sp) => ({
              name: sp.name,
              amount_cents:
                sp.amount === "" ? 0 : Math.round(Number(sp.amount) * 100),
            })),
          }
        : undefined;

    const body: Record<string, unknown> = {
      name: basicInfoData.name,
      description: basicInfoData.description || undefined,
      venue_name: basicInfoData.venueName || undefined,
      venue_state: basicInfoData.venueState || undefined,
      venue_address: basicInfoData.venueAddress || undefined,
    };

    if (formatData.formatType || formatData.system || formatData.rounds !== "") {
      body.format = {
        type: formatData.formatType,
        system: formatData.system,
        rounds: formatData.rounds === "" ? 0 : formatData.rounds,
      };
    }

    if (formatData.baseTime !== "") {
      body.time_control = {
        base_minutes: formatData.baseTime,
        increment_seconds: formatData.increment === "" ? 0 : formatData.increment,
        delay_seconds: formatData.delay === "" ? 0 : formatData.delay,
      };
    }

    if (formatData.startDate) body.start_date = formatData.startDate;
    if (formatData.endDate) body.end_date = formatData.endDate;
    if (formatData.registrationDeadline)
      body.registration_deadline = formatData.registrationDeadline;
    if (formatData.maxParticipants !== "")
      body.max_participants = formatData.maxParticipants;

    body.is_fide_rated = formatData.fideRated;
    body.is_mcf_rated = formatData.mcfRated;

    if (formatData.restrictions.length > 0) {
      body.restrictions = formatData.restrictions.map((r) => ({
        type: r.type,
        value: r.value,
      }));
    }

    body.entry_fees = entryFees;
    if (prizes) body.prizes = prizes;

    return body;
  }

  async function saveDraftToApi(): Promise<string | null> {
    const body = buildDraftBody();

    if (tournamentId) {
      const res = await fetch(
        `/api/v1/organizer/${orgId}/tournaments/${tournamentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return res.ok ? tournamentId : null;
    }

    const res = await fetch(`/api/v1/organizer/${orgId}/tournaments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as { data: { id: string } };
    return json.data.id;
  }

  async function handleSaveDraft() {
    if (!basicInfoData.name.trim()) {
      clearWizardStorage();
      router.push(`/organizer/${orgId}/dashboard`);
      return;
    }
    setIsSaving(true);
    try {
      const id = await saveDraftToApi();
      if (id) setTournamentId(id);
    } finally {
      setIsSaving(false);
      clearWizardStorage();
      router.push(`/organizer/${orgId}/dashboard`);
    }
  }

  async function handlePublish() {
    setPublishError(null);
    setIsPublishing(true);
    try {
      if (!basicInfoData.name.trim()) {
        router.push(`/organizer/${orgId}/dashboard`);
        return;
      }
      const draftId = await saveDraftToApi();
      if (draftId) setTournamentId(draftId);
      if (!draftId) {
        setPublishError("Failed to save tournament before publishing. Please try again.");
        return;
      }
      const res = await fetch(
        `/api/v1/organizer/${orgId}/tournaments/${draftId}/publish`,
        { method: "POST" },
      );
      if (!res.ok) {
        const json = (await res.json()) as {
          error?: { message?: string; details?: string[] };
        };
        const details = json.error?.details;
        setPublishError(
          details && details.length > 1
            ? details.join(" · ")
            : (json.error?.message ?? "Failed to publish tournament."),
        );
        return;
      }
      clearWizardStorage();
      router.push(`/organizer/${orgId}/dashboard`);
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleNext() {
    await triggerStepHandler(currentStepIndex);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-5">
        <p className="font-lato text-xs text-text-muted uppercase tracking-widest mb-1">
          {orgName}
        </p>
        <h1 className="font-cinzel text-xl font-bold text-text-primary tracking-wide">
          Create Tournament
        </h1>
      </div>

      <div className="card overflow-hidden">
        <WizardProgressBar />

        <div className="px-6 py-7 sm:px-8">
          <StepContent />
        </div>

        {publishError && (
          <div className="mx-6 mb-0 mt-4 rounded-md border border-red-400 bg-red-50 px-4 py-3 sm:mx-8">
            <p className="font-lato text-xs text-red-700">{publishError}</p>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border bg-bg-raised px-6 py-4 sm:px-8">
          <button
            type="button"
            className={`font-cinzel border-border text-text-secondary cursor-pointer rounded-md border bg-transparent px-4 py-2 text-xs font-bold tracking-widest uppercase transition duration-200 hover:border-gold-muted hover:text-text-primary ${
              isFirstStep ? "invisible" : ""
            }`}
            onClick={goBack}
            aria-hidden={isFirstStep}
          >
            ← Back
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="font-cinzel border-border text-text-secondary cursor-pointer rounded-md border bg-transparent px-4 py-2 text-xs font-bold tracking-widest uppercase transition duration-200 hover:border-gold-muted hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSaveDraft}
              disabled={isSaving}
            >
              {isSaving ? "Saving…" : "Save Draft"}
            </button>

            {isLastStep ? (
              <button
                type="button"
                className="font-cinzel text-bg-base cursor-pointer rounded-md border-0 px-5 py-2 text-xs font-bold tracking-widest uppercase transition duration-200 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-gold-bright), var(--color-gold-deep))",
                }}
                onClick={handlePublish}
                disabled={isPublishing || isSaving}
              >
                {isPublishing ? "Publishing…" : "Publish"}
              </button>
            ) : (
              <button
                type="button"
                className="font-cinzel text-bg-base cursor-pointer rounded-md border-0 px-5 py-2 text-xs font-bold tracking-widest uppercase transition duration-200 hover:opacity-90"
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-gold-bright), var(--color-gold-deep))",
                }}
                onClick={handleNext}
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
