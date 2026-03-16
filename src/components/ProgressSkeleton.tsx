export default function ProgressSkeleton() {
  return (
    <footer className="w-full max-w-xl">
      <div className="mb-2 flex items-center justify-between text-xs text-(--color-text-muted)">
        <span className="[font-family:var(--font-cinzel)] tracking-[0.05em]">
          Build Progress
        </span>
        <span className="text-(--color-gold-bright)">…</span>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-(--color-bg-raised)"
        role="progressbar"
        aria-valuenow={0}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full w-0 rounded-full progress-fill" />
      </div>
    </footer>
  );
}
