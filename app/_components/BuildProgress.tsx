import { getIssueProgress } from "@/lib/github";

export default async function BuildProgress() {
  const percentage = await getIssueProgress();

  return (
    <footer className="w-full max-w-xl">
      <div
        className="mb-2 flex items-center justify-between text-xs"
        style={{ color: "var(--color-text-muted)" }}
      >
        <span
          style={{
            fontFamily: "var(--font-cinzel)",
            letterSpacing: "0.05em",
          }}
        >
          Build Progress
        </span>
        <span>
          <span style={{ color: "var(--color-gold-bright)" }}>
            {percentage}%
          </span>
        </span>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-full"
        style={{ background: "var(--color-bg-raised)" }}
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${percentage}%`,
            background:
              "linear-gradient(90deg, var(--color-gold-bright), var(--color-gold-deep))",
          }}
        />
      </div>
    </footer>
  );
}
