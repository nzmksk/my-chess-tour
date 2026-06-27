import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import TournamentManageClient from "./_components/TournamentManageClient";
import { getTournamentManageData } from "./_data/getTournamentManageData";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgId: string; id: string }>;
}): Promise<Metadata> {
  const { orgId, id } = await params;
  const result = await getTournamentManageData(orgId, id);

  return {
    title: result.ok ? `Manage: ${result.data.tournament.name}` : "Tournament",
    description: "Manage your tournament registrations and participants.",
  };
}

export default async function TournamentManagePage({
  params,
}: {
  params: Promise<{ orgId: string; id: string }>;
}) {
  const { orgId, id } = await params;

  const result = await getTournamentManageData(orgId, id);

  if (!result.ok) {
    if (result.status === 401) {
      redirect("/auth/login");
    }
    notFound();
  }

  const { tournament, stats, participants } = result.data;

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <TournamentManageClient
        orgId={orgId}
        tournament={tournament}
        stats={stats}
        participants={participants}
      />
    </div>
  );
}
