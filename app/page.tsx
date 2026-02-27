import { getIssueProgress } from "@/lib/github";
import WaitlistForm from "@/app/_components/WaitlistForm";

export const revalidate = 3600; // refresh GitHub stats once per hour

export default async function HomePage() {
  const percentage = await getIssueProgress();

  return (
    <main
      className="flex h-screen flex-col items-center justify-between overflow-hidden px-6 py-10"
      style={{ background: "var(--color-bg-base)" }}
    >
      {/* Top spacer */}
      <div />

      {/* Centre content */}
      <section className="flex flex-col items-center gap-8 text-center">
        {/* Brand wordmark */}
        <h1
          className="text-3xl tracking-[0.2em] uppercase"
          style={{
            color: "var(--color-gold-bright)",
            fontFamily: "var(--font-cinzel)",
          }}
        >
          MY Chess Tour
        </h1>

        {/* Divider */}
        <div
          className="h-px w-16"
          style={{ background: "var(--color-gold-bright)" }}
        />

        {/* Headline */}
        <h1
          className="text-5xl font-semibold tracking-[0.08em] sm:text-6xl"
          style={{
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-cinzel)",
          }}
        >
          Coming Soon
          <span style={{ color: "var(--color-gold-bright)" }}> 2026</span>
        </h1>

        {/* Sub-copy */}
        <p
          className="max-w-sm text-base font-light leading-7"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Malaysia&apos;s premier competitive chess circuit is on its way. Be
          the first to know when we launch.
        </p>

        {/* Waitlist form */}
        <WaitlistForm />
      </section>

      {/* Progress bar */}
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
    </main>
  );
}
