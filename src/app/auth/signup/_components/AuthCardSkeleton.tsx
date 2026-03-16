type AuthCardSkeletonProps = {
  rows?: number;
};

export default function AuthCardSkeleton({ rows = 4 }: AuthCardSkeletonProps) {
  return (
    <div className="auth-page">
      <div className="auth-card card card--featured">
        {/* Step tracker skeleton */}
        <div className="step-tracker mb-10">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div className="skeleton-shimmer w-7 h-7 rounded-full" />
                <div className="skeleton-shimmer h-2 w-10 rounded" />
              </div>
              {i < 3 && <div className="skeleton-shimmer h-px w-10 mx-1" />}
            </div>
          ))}
        </div>

        {/* Header skeleton */}
        <div className="flex flex-col items-center gap-3 mb-10">
          <div className="skeleton-shimmer h-3 w-32 rounded" />
          <div className="skeleton-shimmer h-7 w-48 rounded" />
          <div className="skeleton-shimmer h-3 w-40 rounded" />
          <div className="skeleton-shimmer h-0.5 w-12 rounded mt-2" />
        </div>

        {/* Form rows skeleton */}
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="mb-6">
            <div className="skeleton-shimmer h-2.5 w-24 rounded mb-1.5" />
            <div className="skeleton-shimmer h-11 w-full rounded" />
          </div>
        ))}

        {/* Button skeleton */}
        <div className="skeleton-shimmer h-12 w-full rounded" />
      </div>
    </div>
  );
}
