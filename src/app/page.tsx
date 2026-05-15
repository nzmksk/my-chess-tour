import { Suspense } from "react";
import WaitlistForm from "@/components/WaitlistForm";
import BuildProgress from "@/components/BuildProgress";
import ProgressSkeleton from "@/components/ProgressSkeleton";

function BrowseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-6"
    >
      <path
        fillRule="evenodd"
        d="M10.5 3.75a6.75 6.75 0 1 0 0 13.5 6.75 6.75 0 0 0 0-13.5ZM2.25 10.5a8.25 8.25 0 1 1 14.59 5.28l4.69 4.69a.75.75 0 1 1-1.06 1.06l-4.69-4.69A8.25 8.25 0 0 1 2.25 10.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PayIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-6"
    >
      <path d="M4.5 3.75a3 3 0 0 0-3 3v.75h21v-.75a3 3 0 0 0-3-3h-15Z" />
      <path
        fillRule="evenodd"
        d="M22.5 9.75h-21v7.5a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3v-7.5Zm-18 3.75a.75.75 0 0 1 .75-.75h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-6"
    >
      <path
        fillRule="evenodd"
        d="M5.166 2.621v.858c-1.035.148-2.059.33-3.071.543a.75.75 0 0 0-.584.859 6.753 6.753 0 0 0 6.138 5.6 6.73 6.73 0 0 0 2.743 1.346A6.707 6.707 0 0 1 9.279 15H8.54c-1.036 0-1.875.84-1.875 1.875V19.5h-.75a2.25 2.25 0 0 0-2.25 2.25c0 .414.336.75.75.75h15a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-2.25-2.25h-.75v-2.625c0-1.036-.84-1.875-1.875-1.875h-.739a6.706 6.706 0 0 1-1.112-3.173 6.73 6.73 0 0 0 2.743-1.347 6.753 6.753 0 0 0 6.139-5.6.75.75 0 0 0-.585-.858 47.077 47.077 0 0 0-3.07-.543V2.62a.75.75 0 0 0-.658-.744 49.22 49.22 0 0 0-6.093-.377c-2.063 0-4.096.128-6.093.377a.75.75 0 0 0-.657.744Zm0 2.629c0 1.196.312 2.32.857 3.294A5.266 5.266 0 0 1 3.16 5.337a45.6 45.6 0 0 1 2.006-.343v.256Zm13.5 0v-.256c.674.1 1.343.214 2.006.343a5.265 5.265 0 0 1-2.863 3.207 6.72 6.72 0 0 0 .857-3.294Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <main className="bg-bg-base min-h-screen">
      {/* Decorative top bar */}
      <div className="mx-auto flex max-w-2xl gap-2 p-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 ${i % 2 === 0 ? "bg-gold-bright" : "bg-bg-raised"}`}
          />
        ))}
      </div>

      <div className="mx-auto max-w-2xl px-6 pb-6">
        {/* Eyebrow */}
        <p className="text--eyebrow text-gold-bright">♟ Coming Soon</p>
        {/* Headline */}
        <h1 className="my-2">
          Malaysia&apos;s tournament circuit, finally online.
        </h1>
        {/* Body copy */}
        <p className="text-text-secondary text-base leading-7 font-light">
          MY Chess Tour is a dedicated platform for discovering, registering,
          and managing chess tournaments across Malaysia — built for players and
          organizers alike.
        </p>
        <p className="text-text-secondary mb-4 text-base leading-7 font-light">
          Join the waitlist to be first in line when we launch.
        </p>
        {/* Feature cards */}
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <div className="card p-4">
            <span className="icon--landing-page">
              <BrowseIcon />
            </span>
            <p className="text--ui-label text-gold-bright mb-2">
              Browse Tournaments
            </p>
            <p className="text-text-secondary text-sm leading-relaxed font-light">
              All upcoming events in one place, filterable by state, format, and
              rating.
            </p>
          </div>
          <div className="card p-4">
            <span className="icon--landing-page">
              <PayIcon />
            </span>
            <p className="text--ui-label text-gold-bright mb-2">
              Register &amp; Pay Online
            </p>
            <p className="text-text-secondary text-sm leading-relaxed font-light">
              FPX, DuitNow QR, e-wallets. No bank transfer receipts. No Google
              Forms.
            </p>
          </div>
          <div className="card p-4">
            <span className="icon--landing-page">
              <TrophyIcon />
            </span>
            <p className="text--ui-label text-gold-bright mb-2">
              For Organizers
            </p>
            <p className="text-text-secondary text-sm leading-relaxed font-light">
              Publish tournaments, manage registrations, and track payouts from
              one dashboard.
            </p>
          </div>
        </div>
        {/* Waitlist form */}
        <WaitlistForm />
        <p className="text--meta mt-1 text-xs leading-relaxed font-light">
          No spam. We will only reach out when the platform is ready — or to ask
          for your feedback before launch.
        </p>
      </div>

      {/* Build progress — second section */}
      <section
        id="progress"
        className="border-border mx-auto max-w-2xl border-t p-6"
      >
        <Suspense fallback={<ProgressSkeleton />}>
          <BuildProgress />
        </Suspense>
      </section>
    </main>
  );
}
