import { Suspense } from "react";
import { headers } from "next/headers";
import NavBar from "@/app/_components/NavBar";
import TournamentsClient from "./_components/TournamentsClient";
import TournamentsGridSkeleton from "./_components/TournamentsGridSkeleton";
import type { Tournament } from "./types";

export const revalidate = 60;

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

  return <TournamentsClient tournaments={tournaments} />;
}

export default function TournamentsPage() {
  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <NavBar />
      <Suspense fallback={<TournamentsGridSkeleton />}>
        <TournamentsData />
      </Suspense>
    </div>
  );
}
