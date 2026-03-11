import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import NavBar from "@/app/_components/NavBar";
import TournamentDetail from "./_components/TournamentDetail";
import DetailSkeleton from "./_components/DetailSkeleton";
import type { TournamentDetail as TournamentDetailType } from "./types";

export const revalidate = 60;

export async function TournamentDetailData({ id }: { id: string }) {
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  let tournament: TournamentDetailType | null = null;

  try {
    const res = await fetch(`${protocol}://${host}/api/v1/tournaments/${id}`, {
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      notFound();
      return null;
    }

    const json = await res.json();
    tournament = json.data ?? null;
  } catch {
    notFound();
    return null;
  }

  if (!tournament) {
    notFound();
    return null;
  }

  return <TournamentDetail tournament={tournament} />;
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
