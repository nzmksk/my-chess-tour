export default function TournamentCardSkeleton() {
  return (
    <article
      className="tournament-card grid-cols-1 sm:grid-cols-[10rem_1fr]"
      aria-hidden="true"
    >
      {/* Poster placeholder */}
      <div className="skeleton-shimmer hidden sm:block min-h-50 shrink-0" />

      {/* Body */}
      <div className="p-4 flex flex-col justify-center">
        {/* Badge row */}
        <div className="flex gap-1.5 mb-3">
          <div className="skeleton-shimmer w-15.5 h-4.5 rounded-xs" />
          <div className="skeleton-shimmer w-11 h-4.5 rounded-xs" />
        </div>

        {/* Title */}
        <div className="skeleton-shimmer w-4/5 h-5 rounded-xs mb-3" />

        {/* Meta rows */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="skeleton-shimmer w-[55%] h-3.25 rounded-xs" />
          <div className="skeleton-shimmer w-[65%] h-3.25 rounded-xs" />
          <div className="skeleton-shimmer w-[45%] h-3.25 rounded-xs" />
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center pt-3 border-t border-(--color-border)">
          <div className="skeleton-shimmer w-12 h-5.5 rounded-xs" />
          <div className="skeleton-shimmer w-18 h-8.5 rounded-xs" />
        </div>
      </div>
    </article>
  );
}
