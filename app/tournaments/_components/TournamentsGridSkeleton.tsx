import TournamentCardSkeleton from "./TournamentCardSkeleton";

const SKELETON_COUNT = 6;

export default function TournamentsGridSkeleton() {
  return (
    <>
      {/* Filter bar skeleton */}
      <div className="bg-(--color-bg-surface) border-b border-(--color-border) py-4">
        <div className="max-w-300 mx-auto px-10">
          {/* Search bar */}
          <div className="skeleton-shimmer w-full h-10.5 rounded-xs" />

          {/* Filter buttons */}
          <div className="flex gap-2.5 mt-3">
            {["w-20", "w-17", "w-18", "w-21"].map((w, i) => (
              <div key={i} className={`skeleton-shimmer ${w} h-10 rounded-xs`} />
            ))}
          </div>
        </div>
      </div>

      {/* Card grid */}
      <div className="max-w-300 mx-auto px-10 py-6">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(400px,100%),1fr))] gap-4">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <TournamentCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </>
  );
}
