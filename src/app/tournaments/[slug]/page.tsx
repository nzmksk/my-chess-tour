import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import TournamentDetail from "./_components/TournamentDetail";
import DetailSkeleton from "./_components/DetailSkeleton";
import type {
  TournamentDetail as TournamentDetailType,
  StartingRankPlayer,
} from "./types";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import {
  ONE_DAY_SECONDS,
  TOURNAMENTS_LIST_TAG,
  tournamentTag,
} from "@/lib/cache-tags";

// Must be a literal — Next statically analyzes this export. Mirrors ONE_DAY_SECONDS (86400).
export const revalidate = 86400;

async function fetchTournament(
  slug: string,
): Promise<TournamentDetailType | null> {
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(
      `${protocol}://${host}/api/v1/tournaments/${slug}`,
      {
        next: {
          revalidate: ONE_DAY_SECONDS,
          tags: [TOURNAMENTS_LIST_TAG, tournamentTag(slug)],
        },
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

async function fetchStartingRank(
  tournamentId: string,
  formatType: string,
): Promise<StartingRankPlayer[]> {
  const { data: registrations, error: regError } = await supabaseAdmin
    .from("registrations")
    .select("user_id")
    .eq("tournament_id", tournamentId)
    .eq("status", "confirmed");

  if (regError || !registrations || registrations.length === 0) {
    return [];
  }

  const userIds = (registrations as Array<{ user_id: string | null }>)
    .map((r) => r.user_id)
    .filter((id): id is string => id != null);

  if (userIds.length === 0) return [];

  const [{ data: users }, { data: profiles }] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("id, first_name, last_name")
      .in("id", userIds),
    supabaseAdmin
      .from("player_profiles")
      .select(
        "user_id, title, fide_id, fide_rating, national_rating, nationality, mcf_id, gender",
      )
      .in("user_id", userIds),
  ]);

  const userMap = new Map(
    (
      (users as Array<{ id: string; first_name: string; last_name: string }>) ??
      []
    ).map((u) => [u.id, u]),
  );
  const profileMap = new Map(
    (
      (profiles as Array<{
        user_id: string;
        title: string | null;
        fide_id: number | null;
        fide_rating: Record<string, number> | null;
        national_rating: number | null;
        nationality: string | null;
        mcf_id: number | null;
        gender: "male" | "female" | null;
      }>) ?? []
    ).map((p) => [p.user_id, p]),
  );

  const players = userIds
    .map((userId) => {
      const user = userMap.get(userId);
      if (!user) return null;

      const profile = profileMap.get(userId);
      const fideRatingObj = profile?.fide_rating ?? null;

      let fide_rating: number | null = null;
      if (fideRatingObj) {
        if (formatType === "blitz") {
          fide_rating =
            fideRatingObj.blitz ??
            fideRatingObj.rapid ??
            fideRatingObj.standard ??
            null;
        } else if (formatType === "rapid") {
          fide_rating = fideRatingObj.rapid ?? fideRatingObj.standard ?? null;
        } else {
          fide_rating = fideRatingObj.standard ?? null;
        }
      }

      return {
        user_id: userId,
        name: `${user.first_name} ${user.last_name}`,
        title: profile?.title ?? null,
        fide_id: profile?.fide_id ?? null,
        fide_rating,
        national_rating: profile?.national_rating ?? null,
        nationality: profile?.nationality ?? null,
        mcf_id: profile?.mcf_id ?? null,
        gender: profile?.gender ?? null,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  players.sort((a, b) => {
    const hasFideA = a.fide_rating != null;
    const hasFideB = b.fide_rating != null;
    const hasMcfA = a.national_rating != null;
    const hasMcfB = b.national_rating != null;

    if (hasFideA && hasFideB) return b.fide_rating! - a.fide_rating!;
    if (hasFideA) return -1;
    if (hasFideB) return 1;
    if (hasMcfA && hasMcfB) return b.national_rating! - a.national_rating!;
    if (hasMcfA) return -1;
    if (hasMcfB) return 1;
    return a.name.localeCompare(b.name);
  });

  return players.map((p, i) => ({ ...p, rank: i + 1 }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tournament = await fetchTournament(slug);

  if (!tournament) {
    return {
      title: "Tournament Not Found",
    };
  }

  const startDate = new Date(tournament.start_date).toLocaleDateString(
    "en-MY",
    { day: "numeric", month: "long", year: "numeric" },
  );
  const endDate = new Date(tournament.end_date).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const description =
    tournament.description?.trim() ||
    `${tournament.name} — a ${tournament.format.type} chess tournament held at ${tournament.venue.name}, ${tournament.venue.state} from ${startDate} to ${endDate}.${tournament.is_fide_rated ? " FIDE rated." : ""}${tournament.is_mcf_rated ? " MCF rated." : ""}`;

  const ogTitle = `${tournament.name} | MY Chess Tour`;

  return {
    title: tournament.name,
    description,
    openGraph: {
      title: ogTitle,
      description,
      type: "article",
      siteName: "MY Chess Tour",
    },
    twitter: {
      card: "summary",
      title: ogTitle,
      description,
    },
  };
}

export async function TournamentDetailData({ slug }: { slug: string }) {
  const tournament = await fetchTournament(slug);

  if (!tournament) {
    return notFound();
  }

  // The slug resolved to a tournament; use its UUID for all internal queries.
  const tournamentId = tournament.id;

  const claims = await getAuthClaims();

  let registrationStatus: string | null = null;
  if (claims) {
    const { data: registration } = await supabaseAdmin
      .from("registrations")
      .select("status")
      .eq("user_id", claims.id)
      .eq("tournament_id", tournamentId)
      .maybeSingle();
    registrationStatus = registration?.status ?? null;
  }
  const isConfirmed = registrationStatus === "confirmed";

  const now = new Date();
  // Registration always closes on or before the tournament starts, so a closed
  // deadline already covers the "tournament has started" case.
  const registrationClosed = new Date(tournament.registration_deadline) <= now;
  const isAtCapacity =
    tournament.max_participants > 0 &&
    tournament.current_participants >= tournament.max_participants;
  const canViewStartingRank = registrationClosed || isAtCapacity || isConfirmed;

  const startingRank = canViewStartingRank
    ? await fetchStartingRank(tournamentId, tournament.format.type)
    : null;

  return (
    <TournamentDetail
      tournament={tournament}
      isAuthenticated={!!claims}
      registrationStatus={registrationStatus}
      canViewStartingRank={canViewStartingRank}
      startingRank={startingRank}
    />
  );
}

export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <Suspense fallback={<DetailSkeleton />}>
        <TournamentDetailData slug={slug} />
      </Suspense>
    </div>
  );
}
