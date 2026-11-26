import { Suspense } from "react";
import WaitlistForm from "@/components/WaitlistForm";
import BuildProgress from "@/components/BuildProgress";
import ProgressSkeleton from "@/components/ProgressSkeleton";
import {
  BrowseIcon,
  FamilyIcon,
  PayIcon,
  ProfileCardIcon,
  SparklesIcon,
  TrophyIcon,
} from "@/components/Icons";

const FEATURES = [
  {
    icon: BrowseIcon,
    title: "Browse Tournaments",
    body: "All upcoming events in one place, filterable by state, format, and rating.",
  },
  {
    icon: PayIcon,
    title: "Register & Pay Online",
    body: "Pay with FPX or DuitNow. Complete registration in just 4 clicks.",
  },
  {
    icon: ProfileCardIcon,
    title: "One Player Profile",
    body: "Fill your details once. No more repetitive Google Forms during registration.",
  },
  {
    icon: FamilyIcon,
    title: "For Parents",
    body: "One account for the whole family: enter your kids into tournaments and pay for them in one go.",
  },
  {
    icon: TrophyIcon,
    title: "For Organizers",
    body: "Publish tournaments, manage registrations, and track payouts from one dashboard.",
  },
];

export default function LandingPage() {
  return (
    <main className="bg-bg-base flex min-h-dvh flex-col justify-center">
      {/* Decorative top bar */}
      <div className="mx-auto flex w-full max-w-2xl gap-2 px-6 py-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 ${i % 2 === 0 ? "bg-gold-bright" : "bg-bg-raised"}`}
          />
        ))}
      </div>

      <div className="mx-auto w-full max-w-2xl px-6 pb-8">
        {/* Eyebrow */}
        <p className="text--eyebrow">♟ Coming Soon 2027</p>
        {/* Headline */}
        <h1 className="my-2">Malaysia&apos;s finest chess tournament hub.</h1>
        {/* Body copy */}
        <p className="text--body mb-2">
          MY Chess Tour is a dedicated platform for discovering, registering,
          and managing chess tournaments across Malaysia — built for the chess community.
        </p>
        {/* Feature cards */}
        <div className="my-6 grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="card flex flex-col p-4">
              <span className="icon--landing-page">
                <Icon />
              </span>
              <p className="text--ui-label text-gold-bright mb-2 grow">
                {title}
              </p>
              <p className="text--small">{body}</p>
            </div>
          ))}
          <div className="card flex flex-col border-dashed p-4">
            <span className="icon--landing-page">
              <SparklesIcon />
            </span>
            <p className="text--ui-label text-gold-bright mb-2 grow">
              More Coming Soon
            </p>
            <p className="text--small">
              More exciting features are on the way. Join the waitlist to hear
              about them first.
            </p>
          </div>
        </div>
        {/* Waitlist form */}
        <WaitlistForm />
      </div>
      {/* Build progress — second section */}
      <section
        id="progress"
        className="border-border mx-auto w-full max-w-2xl border-t px-6 py-8"
      >
        <Suspense fallback={<ProgressSkeleton />}>
          <BuildProgress />
        </Suspense>
      </section>
    </main>
  );
}
