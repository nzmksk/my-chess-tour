import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import PlayerDashboardShell from "./_components/PlayerDashboardShell";
import RegistrationsClient from "./tournaments/_components/RegistrationsClient";
import type { PlayerRegistration } from "./tournaments/types";

export const metadata: Metadata = {
  title: "My Tournaments",
  description: "View and manage your chess tournament registrations.",
};

async function fetchRegistrations(
  host: string,
  cookieHeader: string,
): Promise<PlayerRegistration[]> {
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(`${protocol}://${host}/api/v1/me/registrations`, {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

// Personal-account dashboard home. Defaults to the My Tournaments view; Profile
// is reachable from the shared sidebar (PlayerDashboardShell).
export default async function MyDashboardPage() {
  const claims = await getAuthClaims();

  if (!claims) {
    redirect("/auth/login");
  }

  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const cookieHeader = headersList.get("cookie") ?? "";
  const registrations = await fetchRegistrations(host, cookieHeader);

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <PlayerDashboardShell>
        <RegistrationsClient registrations={registrations} />
      </PlayerDashboardShell>
    </div>
  );
}
