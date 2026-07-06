import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import PlayerDashboardShell from "@/app/my/_components/PlayerDashboardShell";
import PublicProfile from "./_components/PublicProfile";
import { getPublicProfile } from "./_data/getPublicProfile";

export const metadata: Metadata = {
  title: "My Profile",
  description: "Your public chess player profile.",
};

export default async function ProfilePage() {
  const claims = await getAuthClaims();

  if (!claims) {
    redirect("/auth/login");
  }

  const profile = await getPublicProfile(claims.id);

  if (!profile) {
    redirect("/auth/login");
  }

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <PlayerDashboardShell>
        <PublicProfile profile={profile} isOwner={true} />
      </PlayerDashboardShell>
    </div>
  );
}
