"use client";

import { WIZARD_STEPS, useTournamentWizard } from "./TournamentWizardContext";

export default function WizardProgressBar() {
  const { currentStepIndex, completedSteps, goToStep } = useTournamentWizard();

  return (
    <div className="border-border bg-bg-raised flex border-b">
      {WIZARD_STEPS.map((step, index) => {
        const isDone = completedSteps.has(index);
        const isCurrent = index === currentStepIndex;
        const isClickable = isDone || index < currentStepIndex;

        return (
          <div
            key={step.id}
            className={`relative flex flex-1 items-center justify-center gap-2 px-3 py-3.5 text-xs transition-colors duration-150 ${
              isClickable
                ? "cursor-pointer"
                : isCurrent
                  ? "cursor-default"
                  : "cursor-default"
            } ${isCurrent ? "border-gold-bright border-b-2" : "border-b-2 border-transparent"}`}
            onClick={() => isClickable && goToStep(index)}
            role={isClickable ? "button" : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={
              isClickable
                ? (e) => e.key === "Enter" && goToStep(index)
                : undefined
            }
            aria-current={isCurrent ? "step" : undefined}
          >
            <div
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-150 ${
                isDone
                  ? "border-gold-bright bg-gold-ghost text-gold-bright border"
                  : isCurrent
                    ? "text-bg-base border-0"
                    : "border-border bg-bg-sunken text-text-disabled border"
              }`}
              style={
                isCurrent
                  ? {
                      background:
                        "linear-gradient(135deg, var(--color-gold-bright), var(--color-gold-deep))",
                    }
                  : undefined
              }
            >
              {isDone ? "✓" : index + 1}
            </div>
            <span
              className={`font-cinzel hidden text-xs font-semibold tracking-widest uppercase sm:block ${
                isCurrent
                  ? "text-gold-bright"
                  : isDone
                    ? "text-text-secondary"
                    : "text-text-disabled"
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
