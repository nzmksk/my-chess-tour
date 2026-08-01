"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WIZARD_STEPS, useTournamentWizard } from "./TournamentWizardContext";
import WizardProgressBar from "./WizardProgressBar";
import { toPersistedRestrictions } from "./restrictions";
import { toPersistedEntryFees } from "./entryFees";
import { resolveTimeZone, toInstantInTimeZone } from "@/lib/datetime";
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
  title?: string;
  redirectPath?: string;
  mode?: "create" | "edit";
}

export default function WizardShell({
  orgId,
  orgName,
  title = "Create Tournament",
  redirectPath,
  mode = "create",
}: WizardShellProps) {
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
    isHydrated,
  } = useTournamentWizard();
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === WIZARD_STEPS.length - 1;

  const StepContent = STEP_COMPONENTS[currentStepIndex];

  function buildDraftBody(): Record<string, unknown> {
    // Everything dated in the wizard is dated at the venue, so the venue's
    // timezone is what turns the organizer's wall-clock entries into instants.
    const timeZone = resolveTimeZone(basicInfoData.timezone);
    const entryFees = toPersistedEntryFees(feesData, timeZone);

    const prizes =
      prizesData.categories.length > 0 || prizesData.specialPrizes.length > 0
        ? {
            categories: prizesData.categories.map((cat) => ({
              name: cat.name,
              entries: cat.prizes.map((p) => ({
                place: p.placement,
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
      timezone: timeZone,
    };

    if (
      formatData.formatType ||
      formatData.system ||
      formatData.rounds !== ""
    ) {
      body.format = {
        type: formatData.formatType,
        system: formatData.system,
        rounds: formatData.rounds === "" ? 0 : formatData.rounds,
      };
    }

    if (formatData.baseTime !== "") {
      body.time_control = {
        base_minutes: formatData.baseTime,
        increment_seconds:
          formatData.increment === "" ? 0 : formatData.increment,
        delay_seconds: formatData.delay === "" ? 0 : formatData.delay,
      };
    }

    if (formatData.startDate) body.start_date = formatData.startDate;
    if (formatData.endDate) body.end_date = formatData.endDate;
    if (formatData.registrationDeadline)
      // The deadline input is a wall-clock time with no zone; sent bare it
      // would be read in the database's zone rather than the venue's.
      body.registration_deadline = toInstantInTimeZone(
        formatData.registrationDeadline,
        timeZone,
      );
    if (formatData.maxParticipants !== "")
      body.max_participants = formatData.maxParticipants;

    body.is_fide_rated = formatData.fideRated;
    body.is_mcf_rated = formatData.mcfRated;

    if (formatData.restrictions.length > 0) {
      body.restrictions = toPersistedRestrictions(formatData.restrictions);
    }

    body.entry_fees = entryFees;
    if (prizes) body.prizes = prizes;

    return body;
  }

  async function saveDraftToApi(): Promise<string | null> {
    const body = buildDraftBody();

    if (tournamentId) {
      const res = await fetch(
        `/api/v1/organizations/${orgId}/tournaments/${tournamentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return res.ok ? tournamentId : null;
    }

    const res = await fetch(`/api/v1/organizations/${orgId}/tournaments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as { data: { id: string } };
    return json.data.id;
  }

  const afterSaveRedirect = redirectPath ?? `/my/organizations/${orgId}`;

  async function handleSaveDraft() {
    if (!basicInfoData.name.trim()) {
      clearWizardStorage();
      router.push(afterSaveRedirect);
      return;
    }
    setIsSaving(true);
    try {
      const id = await saveDraftToApi();
      if (id) setTournamentId(id);
    } finally {
      setIsSaving(false);
      clearWizardStorage();
      router.push(afterSaveRedirect);
    }
  }

  async function handlePublish() {
    setPublishError(null);
    setIsPublishing(true);
    try {
      if (!basicInfoData.name.trim()) {
        router.push(afterSaveRedirect);
        return;
      }
      const draftId = await saveDraftToApi();
      if (draftId) setTournamentId(draftId);
      if (!draftId) {
        setPublishError(
          "Failed to save tournament before publishing. Please try again.",
        );
        return;
      }
      const res = await fetch(
        `/api/v1/organizations/${orgId}/tournaments/${draftId}/publish`,
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
      router.push(afterSaveRedirect);
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
        <p className="font-lato text-text-muted mb-1 text-xs tracking-widest uppercase">
          {orgName}
        </p>
        <h1 className="font-cinzel text-text-primary text-xl font-bold tracking-wide">
          {title}
        </h1>
      </div>

      <div className="card overflow-hidden">
        <WizardProgressBar />

        {/* Steps seed their local form state from the context on mount, so they
            must not mount until the context has restored sessionStorage. */}
        <div className="px-6 py-7 sm:px-8">{isHydrated && <StepContent />}</div>

        {publishError && (
          <div className="mx-6 mt-4 mb-0 rounded-md border border-red-400 bg-red-50 px-4 py-3 sm:mx-8">
            <p className="font-lato text-xs text-red-700">{publishError}</p>
          </div>
        )}

        <div className="border-border bg-bg-raised flex items-center justify-between border-t px-6 py-4 sm:px-8">
          <button
            type="button"
            className={`font-cinzel border-border text-text-secondary hover:border-gold-muted hover:text-text-primary cursor-pointer rounded-md border bg-transparent px-4 py-2 text-xs font-bold tracking-widest uppercase transition duration-200 ${
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
              className="font-cinzel border-border text-text-secondary hover:border-gold-muted hover:text-text-primary cursor-pointer rounded-md border bg-transparent px-4 py-2 text-xs font-bold tracking-widest uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleSaveDraft}
              disabled={isSaving}
            >
              {isSaving ? "Saving…" : "Save Draft"}
            </button>

            {isLastStep && mode === "edit" ? (
              <button
                type="button"
                className="font-cinzel text-bg-base cursor-pointer rounded-md border-0 px-5 py-2 text-xs font-bold tracking-widest uppercase transition duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-gold-bright), var(--color-gold-deep))",
                }}
                onClick={handleSaveDraft}
                disabled={isSaving}
              >
                {isSaving ? "Saving…" : "Save Changes"}
              </button>
            ) : isLastStep ? (
              <button
                type="button"
                className="font-cinzel text-bg-base cursor-pointer rounded-md border-0 px-5 py-2 text-xs font-bold tracking-widest uppercase transition duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
