import { Suspense } from "react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import TournamentsClient from "./_components/TournamentsClient";
import TournamentsGridSkeleton from "./_components/TournamentsGridSkeleton";
import ProfileNudge from "./_components/ProfileNudge";
import { getTodayInTimeZone } from "./utils";
import type { Tournament } from "./types";
import { ONE_DAY_SECONDS, TOURNAMENTS_LIST_TAG } from "@/lib/cache-tags";
import { getAuthClaims } from "@/services/supabase/permission";
import { createClient } from "@/services/supabase/server";

// Must be a literal — Next statically analyzes this export. Mirrors ONE_DAY_SECONDS (86400).
export const revalidate = 86400;

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
      next: { revalidate: ONE_DAY_SECONDS, tags: [TOURNAMENTS_LIST_TAG] },
    });

    if (res.ok) {
      const json = await res.json();
      tournaments = json.data ?? [];
    }
  } catch {
    // Network error — render page with empty list rather than crashing
  }

  // Compute "today" in the venue timezone (Malaysia for now) so the
  // ongoing/upcoming/past buckets don't shift a day on a UTC server.
  const today = getTodayInTimeZone();
  return <TournamentsClient tournaments={tournaments} today={today} />;
}

// Signed-in players with a half-empty profile get a dismissible nudge above the
// list. "Incomplete" = missing gender, date of birth, or nationality (the
// broadly-needed fields); FIDE/MCF IDs are situational and handled at registration.
async function ProfileNudgeSlot() {
  const claims = await getAuthClaims();
  if (!claims) return null;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("player_profiles")
    .select("gender, date_of_birth, nationality")
    .eq("user_id", claims.id)
    .maybeSingle();

  const incomplete =
    !profile ||
    profile.gender == null ||
    profile.date_of_birth == null ||
    profile.nationality == null;
  if (!incomplete) return null;

  return <ProfileNudge />;
}

export default function TournamentsPage() {
  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <div className="mx-auto w-full max-w-6xl px-4">
        <Suspense fallback={null}>
          <ProfileNudgeSlot />
        </Suspense>
      </div>
      <Suspense fallback={<TournamentsGridSkeleton />}>
        <TournamentsData />
      </Suspense>
    </div>
  );
}
