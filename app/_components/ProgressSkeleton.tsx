export default function ProgressSkeleton() {
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
        <span style={{ color: "var(--color-gold-bright)" }}>…</span>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-full"
        style={{ background: "var(--color-bg-raised)" }}
        role="progressbar"
        aria-valuenow={0}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full w-0 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, var(--color-gold-bright), var(--color-gold-deep))",
          }}
        />
      </div>
    </footer>
  );
}
