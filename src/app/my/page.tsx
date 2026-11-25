import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import {
  listInvitationsForUser,
  type InvitationView,
} from "@/services/organizations/invitations";
import PlayerDashboardShell from "./_components/PlayerDashboardShell";
import InvitationsPanel from "./_components/InvitationsPanel";
import RegistrationsClient from "./tournaments/_components/RegistrationsClient";
import type { PlayerRegistration } from "./tournaments/types";

export const metadata: Metadata = {
  title: "My Tournaments",
  description: "View and manage your chess tournament registrations.",
};

async function fetchRegistrations(
  host: string,
  cookieHeader: string,
): Promise<PlayerRegistration[] | null> {
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(`${protocol}://${host}/api/v1/me/registrations`, {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    });
    if (!res.ok) {
      console.error(
        `My dashboard: failed to load registrations (HTTP ${res.status})`,
      );
      return null;
    }
    const json = await res.json();
    return json.data ?? [];
  } catch (err) {
    console.error("My dashboard: failed to load registrations", err);
    return null;
  }
}

// A failure to load invitations only hides the panel; the dashboard still renders.
async function fetchInvitations(userId: string): Promise<InvitationView[]> {
  try {
    return await listInvitationsForUser(userId);
  } catch (err) {
    console.error("My dashboard: failed to load invitations", err);
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
  const [registrations, invitations] = await Promise.all([
    fetchRegistrations(host, cookieHeader),
    fetchInvitations(claims.id),
  ]);

  return (
    <div className="bg-bg-base flex-1">
      <NavBar />
      <PlayerDashboardShell>
        <InvitationsPanel invitations={invitations} />
        <RegistrationsClient registrations={registrations} />
      </PlayerDashboardShell>
    </div>
  );
}
