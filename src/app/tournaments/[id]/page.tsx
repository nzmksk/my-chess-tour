import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import TournamentDetail from "./_components/TournamentDetail";
import DetailSkeleton from "./_components/DetailSkeleton";
import type { TournamentDetail as TournamentDetailType } from "./types";
import { createClient } from "@/services/supabase/server";

export const revalidate = 60;

async function fetchTournament(
  id: string
): Promise<TournamentDetailType | null> {
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(`${protocol}://${host}/api/v1/tournaments/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tournament = await fetchTournament(id);

  if (!tournament) {
    return {
      title: "Tournament Not Found",
    };
  }

  const startDate = new Date(tournament.start_date).toLocaleDateString(
    "en-MY",
    { day: "numeric", month: "long", year: "numeric" }
  );
  const endDate = new Date(tournament.end_date).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const description =
    tournament.description?.trim() ||
    `${tournament.name} — a ${tournament.format.type} chess tournament held at ${tournament.venue_name}, ${tournament.state} from ${startDate} to ${endDate}.${tournament.is_fide_rated ? " FIDE rated." : ""}${tournament.is_mcf_rated ? " MCF rated." : ""}`;

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

export async function TournamentDetailData({ id }: { id: string }) {
  const tournament = await fetchTournament(id);

  if (!tournament) {
    notFound();
    return null;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return <TournamentDetail tournament={tournament} isAuthenticated={!!user} />;
}

export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <NavBar />
      <Suspense fallback={<DetailSkeleton />}>
        <TournamentDetailData id={id} />
      </Suspense>
    </div>
  );
}
