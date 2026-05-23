import { Suspense } from "react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import TournamentsClient from "./_components/TournamentsClient";
import TournamentsGridSkeleton from "./_components/TournamentsGridSkeleton";
import type { Tournament } from "./types";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Upcoming Chess Tournaments in Malaysia",
  description:
    "See all upcoming open chess tournaments in Malaysia. Filter by state, format, and rating. Register online and pay securely with FPX, DuitNow QR, or e-wallet.",
  openGraph: {
    title: "Upcoming Chess Tournaments in Malaysia | MY Chess Tour",
    description:
      "See all upcoming open chess tournaments in Malaysia. Filter by state, format, and rating. Register online and pay securely with FPX, DuitNow QR, or e-wallet.",
    type: "website",
    siteName: "MY Chess Tour",
  },
  twitter: {
    card: "summary",
    title: "Upcoming Chess Tournaments in Malaysia | MY Chess Tour",
    description:
      "See all upcoming open chess tournaments in Malaysia. Filter by state, format, and rating. Register online and pay securely with FPX, DuitNow QR, or e-wallet.",
  },
};

async function TournamentsData() {
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  let tournaments: Tournament[] = [];

  try {
    const res = await fetch(`${protocol}://${host}/api/v1/tournaments`, {
      next: { revalidate: 60 },
    });

    if (res.ok) {
      const json = await res.json();
      tournaments = json.data ?? [];
    }
  } catch {
    // Network error — render page with empty list rather than crashing
  }

  const today = new Date().toISOString().split("T")[0];
  return <TournamentsClient tournaments={tournaments} today={today} />;
}

export default function TournamentsPage() {
  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <Suspense fallback={<TournamentsGridSkeleton />}>
        <TournamentsData />
      </Suspense>
    </div>
  );
}
