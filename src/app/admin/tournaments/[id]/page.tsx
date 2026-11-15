import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import TournamentManageClient from "@/app/my/organizations/[orgId]/tournaments/[id]/_components/TournamentManageClient";
import { getAdminTournamentManageData } from "@/app/my/organizations/[orgId]/tournaments/[id]/_data/getTournamentManageData";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getAdminTournamentManageData(id);

  return {
    title: result.ok ? `Admin: ${result.data.tournament.name}` : "Tournament",
    description: "Platform admin view of a tournament and its participants.",
  };
}

// The platform admin's view of any tournament — draft, published or
// cancelled — with the same details and roster the organizer sees, read-only.
export default async function AdminTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await getAdminTournamentManageData(id);

  if (!result.ok) {
    if (result.status === 401) redirect("/auth/login");
    if (result.status === 403) redirect("/");
    notFound();
  }

  const { tournament, stats, participants, cancellationPending, refunds } =
    result.data;

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <TournamentManageClient
        orgId={tournament.organization.id}
        tournament={tournament}
        stats={stats}
        participants={participants}
        cancellationPending={cancellationPending}
        refunds={refunds}
        viewer="admin"
      />
    </div>
  );
}
