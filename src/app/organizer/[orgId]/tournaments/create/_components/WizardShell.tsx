"use client";

import { useRouter } from "next/navigation";
import { WIZARD_STEPS, useTournamentWizard } from "./TournamentWizardContext";
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

export default function WizardShell({ orgId, orgName }: WizardShellProps) {
  const router = useRouter();
  const { currentStepIndex, goNext, goBack, triggerStepHandler } =
    useTournamentWizard();
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === WIZARD_STEPS.length - 1;

  const StepContent = STEP_COMPONENTS[currentStepIndex];

  function handleSaveDraft() {
    router.push(`/organizer/${orgId}/dashboard`);
  }

  function handlePublish() {
    // Placeholder — tournament creation API will be wired up in a follow-up issue
    router.push(`/organizer/${orgId}/dashboard`);
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
              className="font-cinzel border-border text-text-secondary cursor-pointer rounded-md border bg-transparent px-4 py-2 text-xs font-bold tracking-widest uppercase transition duration-200 hover:border-gold-muted hover:text-text-primary"
              onClick={handleSaveDraft}
            >
              Save Draft
            </button>

            {isLastStep ? (
              <button
                type="button"
                className="font-cinzel text-bg-base cursor-pointer rounded-md border-0 px-5 py-2 text-xs font-bold tracking-widest uppercase transition duration-200 hover:opacity-90"
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-gold-bright), var(--color-gold-deep))",
                }}
                onClick={handlePublish}
              >
                Publish
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
