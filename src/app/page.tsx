import { Suspense } from "react";
import WaitlistForm from "@/components/WaitlistForm";
import BuildProgress from "@/components/BuildProgress";
import ProgressSkeleton from "@/components/ProgressSkeleton";
import { BrowseIcon, PayIcon, TrophyIcon } from "@/app/components/Icons";

export default function LandingPage() {
  return (
    <main className="bg-bg-base">
      {/* Decorative top bar */}
      <div className="mx-auto flex max-w-2xl gap-2 px-6 py-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 ${i % 2 === 0 ? "bg-gold-bright" : "bg-bg-raised"}`}
          />
        ))}
      </div>

      <div className="mx-auto max-w-2xl px-6 pb-8">
        {/* Eyebrow */}
        <p className="text--eyebrow">♟ Coming Soon</p>
        {/* Headline */}
        <h1 className="my-2">
          Malaysia&apos;s tournament circuit, finally online.
        </h1>
        {/* Body copy */}
        <p className="text--body mb-2">
          MY Chess Tour is a dedicated platform for discovering, registering,
          and managing chess tournaments across Malaysia — built for players and
          organizers alike.
        </p>
        <p className="text--body">
          Join the waitlist to be first in line when we launch.
        </p>
        {/* Feature cards */}
        <div className="my-6 grid gap-4 sm:grid-cols-3">
          <div className="card flex flex-col p-4">
            <span className="icon--landing-page">
              <BrowseIcon />
            </span>
            <p className="text--ui-label text-gold-bright mb-2 grow">
              Browse Tournaments
            </p>
            <p className="text--small">
              All upcoming events in one place, filterable by state, format, and
              rating.
            </p>
          </div>
          <div className="card flex flex-col p-4">
            <span className="icon--landing-page">
              <PayIcon />
            </span>
            <p className="text--ui-label text-gold-bright mb-2 grow">
              Register &amp; Pay Online
            </p>
            <p className="text--small">
              FPX, DuitNow QR, e-wallets. No bank transfer receipts. No Google
              Forms.
            </p>
          </div>
          <div className="card flex flex-col p-4">
            <span className="icon--landing-page">
              <TrophyIcon />
            </span>
            <p className="text--ui-label text-gold-bright mb-2 grow">
              For Organizers
            </p>
            <p className="text--small">
              Publish tournaments, manage registrations, and track payouts from
              one dashboard.
            </p>
          </div>
        </div>
        {/* Waitlist form */}
        <WaitlistForm />
        <p className="text--meta mt-2 sm:text-center">
          No spam. We will only reach out when the platform is ready — or to ask
          for your feedback before launch.
        </p>
      </div>
      {/* Build progress — second section */}
      <section
        id="progress"
        className="border-border mx-auto max-w-2xl border-t px-6 py-8"
      >
        <Suspense fallback={<ProgressSkeleton />}>
          <BuildProgress />
        </Suspense>
      </section>
    </main>
  );
}
