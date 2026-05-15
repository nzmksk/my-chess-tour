import { getIssueProgress } from "@/services/github/github";

export default async function BuildProgress() {
  const percentage = await getIssueProgress();

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
        <span className="font-cinzel tracking-wider">Build Progress</span>
        <span className="text-gold-bright">{percentage}%</span>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-bg-raised"
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 progress-fill ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
