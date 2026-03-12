export default function DetailSkeleton() {
  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <main className="max-w-[75rem] mx-auto px-6 md:px-10 py-8">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_340px] gap-8 items-start animate-pulse">

          {/* Left column skeleton */}
          <div className="flex flex-col gap-6">
            {/* Title */}
            <div className="flex flex-col gap-2">
              <div className="h-8 bg-(--color-bg-raised) rounded w-3/4" />
              <div className="h-4 bg-(--color-bg-raised) rounded w-1/3" />
            </div>

            {/* Badges */}
            <div className="flex gap-2">
              <div className="h-6 w-16 bg-(--color-bg-raised) rounded" />
              <div className="h-6 w-20 bg-(--color-bg-raised) rounded" />
            </div>

            {/* Details section */}
            <div className="pt-6 border-t border-(--color-border) flex flex-col gap-4">
              <div className="h-5 bg-(--color-bg-raised) rounded w-1/4" />
              <div className="grid grid-cols-2 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="h-3 bg-(--color-bg-raised) rounded w-1/3" />
                    <div className="h-4 bg-(--color-bg-raised) rounded w-2/3" />
                  </div>
                ))}
              </div>
            </div>

            {/* Entry fees section */}
            <div className="pt-6 border-t border-(--color-border) flex flex-col gap-4">
              <div className="h-5 bg-(--color-bg-raised) rounded w-1/4" />
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <div className="h-4 bg-(--color-bg-raised) rounded w-1/3" />
                    <div className="h-4 bg-(--color-bg-raised) rounded w-16" />
                  </div>
                ))}
              </div>
            </div>

            {/* Description section */}
            <div className="pt-6 border-t border-(--color-border) flex flex-col gap-3">
              <div className="h-5 bg-(--color-bg-raised) rounded w-1/4" />
              <div className="h-4 bg-(--color-bg-raised) rounded w-full" />
              <div className="h-4 bg-(--color-bg-raised) rounded w-5/6" />
              <div className="h-4 bg-(--color-bg-raised) rounded w-4/6" />
            </div>
          </div>

          {/* Right column skeleton (register card) */}
          <div className="card card--featured p-6 flex flex-col gap-4">
            <div className="h-5 bg-(--color-bg-raised) rounded w-3/4" />
            <div className="h-10 bg-(--color-bg-raised) rounded w-1/2" />
            <div className="h-10 bg-(--color-bg-raised) rounded w-full" />
            <div className="h-4 bg-(--color-bg-raised) rounded w-2/3" />
            <div className="h-4 bg-(--color-bg-raised) rounded w-1/2" />
          </div>
        </div>
      </main>
    </div>
  );
}
