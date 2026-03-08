export type Step = {
  label: string;
  state: "pending" | "current" | "done";
};

type StepTrackerProps = {
  steps: Step[];
};

export default function StepTracker({ steps }: StepTrackerProps) {
  return (
    <div className="step-tracker">
      {steps.map((step, index) => (
        <div key={step.label} className="flex items-center">
          <div className="step">
            <div
              className={`step-circle${step.state === "current" ? " step-circle--current" : step.state === "done" ? " step-circle--done" : ""}`}
            >
              {step.state === "done" ? "✓" : index + 1}
            </div>
            <span
              className={`step-label${step.state === "current" ? " step-label--current" : ""}`}
            >
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={`step-connector${step.state === "done" ? " step-connector--done" : ""}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
