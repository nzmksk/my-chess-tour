import { getIssueProgress } from "@/services/github/github";

export default async function BuildProgress() {
  const percentage = await getIssueProgress();

  return (
    <div className="w-full">
      <div className="text-text-muted mb-2 flex items-center justify-between text-xs">
        <span className="text--ui-label text-gold-bright">Build Progress</span>
        <span className="text-gold-bright">{percentage}%</span>
      </div>
      <div
        className="bg-bg-raised h-1 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="progress-fill h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
