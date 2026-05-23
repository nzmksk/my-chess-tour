import type { Metadata } from "next";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import {
  TrophyIcon,
  PayIcon,
  BrowseIcon,
} from "@/app/components/Icons";

export const metadata: Metadata = {
  title: "Organizer Hub | MY Chess Tour",
  description:
    "Publish and manage chess tournaments with ease. MY Chess Tour gives organizers the tools to run tournaments, collect payments, and manage registrations — all in one place.",
};

function ChartIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-6"
    >
      <path d="M18.375 2.25c-1.035 0-1.875.84-1.875 1.875v15.75c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V4.125c0-1.036-.84-1.875-1.875-1.875h-.75ZM9.75 8.625c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-.75a1.875 1.875 0 0 1-1.875-1.875V8.625ZM3 13.125c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v6.75c0 1.035-.84 1.875-1.875 1.875h-.75A1.875 1.875 0 0 1 3 19.875v-6.75Z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-6"
    >
      <path
        fillRule="evenodd"
        d="M5.25 9a6.75 6.75 0 0 1 13.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 0 1-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 1 1-7.48 0 24.585 24.585 0 0 1-4.831-1.244.75.75 0 0 1-.298-1.205A8.217 8.217 0 0 0 5.25 9.75V9Zm4.502 8.9a2.25 2.25 0 1 0 4.496 0 25.057 25.057 0 0 1-4.496 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-6"
    >
      <path
        fillRule="evenodd"
        d="M12.516 2.17a.75.75 0 0 0-1.032 0 11.209 11.209 0 0 1-7.877 3.08.75.75 0 0 0-.722.515A12.74 12.74 0 0 0 2.25 9.75c0 5.942 4.064 10.933 9.563 12.348a.749.749 0 0 0 .374 0c5.499-1.415 9.563-6.406 9.563-12.348 0-1.39-.223-2.73-.635-3.985a.75.75 0 0 0-.722-.516l-.143.001c-2.996 0-5.717-1.17-7.734-3.08Zm3.094 8.016a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const FEATURES = [
  {
    icon: <TrophyIcon />,
    title: "Publish Tournaments",
    description:
      "Create and publish tournaments in minutes. Set formats, rounds, time controls, and prize structures from a simple dashboard.",
  },
  {
    icon: <BrowseIcon />,
    title: "Manage Registrations",
    description:
      "View, approve, and track player registrations in real time. Export lists and monitor capacity at a glance.",
  },
  {
    icon: <PayIcon />,
    title: "Collect Payments Online",
    description:
      "Accept entry fees via FPX, DuitNow QR, and e-wallets. No more bank-transfer receipts or manual reconciliation.",
  },
  {
    icon: <ChartIcon />,
    title: "Dashboard Analytics",
    description:
      "Track registration trends, revenue, and payout status from a single organizer dashboard.",
  },
  {
    icon: <BellIcon />,
    title: "Player Communication",
    description:
      "Send announcements and schedule updates directly to all registered players with one click.",
  },
  {
    icon: <ShieldIcon />,
    title: "Verified & Trusted",
    description:
      "Organizer accounts are reviewed before approval, giving players confidence when signing up for your events.",
  },
];

export default function OrganizerLandingPage() {
  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-3xl px-6 py-16 text-center md:px-10">
          <p className="text--eyebrow mb-4">For Organizers</p>
          <h1 className="mb-4">
            Run better chess tournaments, online.
          </h1>
          <p className="text--body text-text-secondary mx-auto mb-8 max-w-xl">
            MY Chess Tour gives organizers everything they need to publish
            events, collect entry fees, and manage players — all in one place.
            No spreadsheets. No bank transfers. No chaos.
          </p>
          <Link href="/organizations/apply" className="btn-primary inline-block px-10 py-3 w-auto">
            Apply Now
          </Link>
        </section>

        {/* Decorative divider */}
        <div className="mx-auto flex max-w-3xl gap-2 px-6 md:px-10">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i % 2 === 0 ? "bg-gold-bright" : "bg-bg-raised"}`}
            />
          ))}
        </div>

        {/* Features */}
        <section className="mx-auto max-w-3xl px-6 py-12 md:px-10">
          <h2 className="mb-2 text-center">Everything you need</h2>
          <p className="text--body text-text-muted mb-10 text-center">
            Built for Malaysian chess organizers, from grassroots clubs to
            national-level events.
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon, title, description }) => (
              <div key={title} className="card flex flex-col p-5">
                <span className="icon--landing-page">{icon}</span>
                <p className="text--ui-label mb-2">{title}</p>
                <p className="text--small">{description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA banner */}
        <section className="border-border mx-auto max-w-3xl border-t px-6 py-12 text-center md:px-10">
          <h2 className="mb-3">Ready to get started?</h2>
          <p className="text--body text-text-secondary mb-8">
            Submit your organizer application and our team will review it
            within a few business days.
          </p>
          <Link href="/organizations/apply" className="btn-primary inline-block px-10 py-3 w-auto">
            Apply Now
          </Link>
        </section>
      </main>
    </div>
  );
}
