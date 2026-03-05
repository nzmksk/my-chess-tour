import { Suspense } from "react";
import WaitlistForm from "@/app/_components/WaitlistForm";
import BuildProgress from "@/app/_components/BuildProgress";
import ProgressSkeleton from "@/app/_components/ProgressSkeleton";

export default function LandingPage() {
  return (
    <main className="flex h-screen flex-col items-center justify-between overflow-hidden px-6 py-10 bg-(--color-bg-base)">
      {/* Top spacer */}
      <div />

      {/* Centre content */}
      <section className="flex flex-col items-center gap-8 text-center">
        {/* Brand wordmark */}
        <h1 className="text-3xl tracking-[0.2em] uppercase text-(--color-gold-bright) [font-family:var(--font-cinzel)]">
          MY Chess Tour
        </h1>

        {/* Divider */}
        <div className="h-px w-16 bg-(--color-gold-bright)" />

        {/* Headline */}
        <h1 className="text-5xl font-semibold tracking-[0.08em] sm:text-6xl text-(--color-text-primary) [font-family:var(--font-cinzel)]">
          Coming Soon
          <span className="text-(--color-gold-bright)"> 2026</span>
        </h1>

        {/* Sub-copy */}
        <p className="max-w-sm text-base font-light leading-7 text-(--color-text-secondary)">
          Malaysia&apos;s premier competitive chess circuit is on its way. Be
          the first to know when we launch.
        </p>

        {/* Waitlist form */}
        <WaitlistForm />
      </section>

      {/* Progress bar streams in when GitHub API responds */}
      <Suspense fallback={<ProgressSkeleton />}>
        <BuildProgress />
      </Suspense>
    </main>
  );
}
