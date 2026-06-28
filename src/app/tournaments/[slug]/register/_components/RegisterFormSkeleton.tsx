export default function RegisterFormSkeleton() {
  return (
    <div className="max-w-lg mx-auto animate-pulse flex flex-col gap-6">
      {/* Title */}
      <div className="h-7 bg-bg-raised rounded w-2/3" />

      {/* Fee tier selector */}
      <div className="card card--featured p-6 flex flex-col gap-4">
        <div className="h-4 bg-bg-raised rounded w-1/3" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex justify-between items-center border border-border rounded-md p-3"
          >
            <div className="h-4 bg-bg-raised rounded w-1/3" />
            <div className="h-4 bg-bg-raised rounded w-16" />
          </div>
        ))}
      </div>

      {/* Cost breakdown */}
      <div className="card p-6 flex flex-col gap-3">
        <div className="h-4 bg-bg-raised rounded w-1/4" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <div className="h-4 bg-bg-raised rounded w-1/3" />
            <div className="h-4 bg-bg-raised rounded w-16" />
          </div>
        ))}
      </div>

      {/* Payment method */}
      <div className="card p-6 flex flex-col gap-4">
        <div className="h-4 bg-bg-raised rounded w-1/4" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 bg-bg-raised rounded-md" />
          ))}
        </div>
      </div>

      {/* Submit button */}
      <div className="h-11 bg-bg-raised rounded-md w-full" />
    </div>
  );
}
