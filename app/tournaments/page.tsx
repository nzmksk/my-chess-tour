import { headers } from "next/headers";
import NavBar from "@/app/_components/NavBar";
import TournamentsClient from "./_components/TournamentsClient";
import type { Tournament } from "./types";

export const revalidate = 60;

export default async function TournamentsPage() {
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

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg-base)" }}>
      <NavBar />
      <TournamentsClient tournaments={tournaments} />
    </div>
  );
}
