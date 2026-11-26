import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import NavBar from "@/components/NavBar";
import PlayerDashboardShell from "@/app/my/_components/PlayerDashboardShell";
import { getAuthClaims } from "@/services/supabase/permission";
import DependentsManager from "./_components/DependentsManager";

export const metadata: Metadata = {
  title: "Dependents",
  description:
    "Add and manage the players you register for tournaments: your children, or adults who have asked you to act for them.",
};

export const dynamic = "force-dynamic";

export default async function DependentsPage() {
  const claims = await getAuthClaims();

  if (!claims) {
    redirect(
      "/auth/login?redirectTo=/settings/dependents&message=login-required",
    );
  }

  return (
    <div className="bg-bg-base flex-1">
      <NavBar />
      <PlayerDashboardShell>
        <div className="mx-auto max-w-2xl px-6 py-8">
          <Link
            href="/settings"
            className="font-lato text-gold-muted hover:text-gold-bright text-sm"
          >
            ← Back to settings
          </Link>
          <h1 className="font-cinzel text-text-primary mt-4 text-2xl font-bold tracking-wide">
            Dependents
          </h1>
          <p className="font-lato text-text-secondary mt-2 mb-6 text-sm">
            Players you register for tournaments from your own account: your
            children under 18, or adults who have asked you to act for them. You
            pay for their entries, and we email you about them.
          </p>
          <DependentsManager />
        </div>
      </PlayerDashboardShell>
    </div>
  );
}
