import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import TournamentManageClient from "./_components/TournamentManageClient";

interface Participant {
  index: number;
  id: string;
  user_id: string;
  name: string;
  fide_id: number | null;
  rating: number | null;
  fee_tier: string;
  status: string;
  registered_at: string;
}

interface TournamentManageData {
  tournament: {
    id: string;
    name: string;
    status: "draft" | "published" | "ongoing" | "completed" | "cancelled";
    start_date: string;
    end_date: string;
    venue: { name: string; state: string; address?: string | null };
    format: { type?: string; system?: string; rounds?: number } | null;
    max_participants: number;
  };
  stats: { total: number; confirmed: number; pending: number };
  participants: Participant[];
}

async function fetchTournamentManage(
  orgId: string,
  id: string,
  cookieHeader: string,
): Promise<TournamentManageData | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  try {
    const res = await fetch(
      `${baseUrl}/api/v1/organizations/${orgId}/tournaments/${id}`,
      {
        cache: "no-store",
        headers: { cookie: cookieHeader },
      },
    );
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
  params: Promise<{ orgId: string; id: string }>;
}): Promise<Metadata> {
  const { orgId, id } = await params;
  const headersList = await headers();
  const cookieHeader = headersList.get("cookie") ?? "";
  const data = await fetchTournamentManage(orgId, id, cookieHeader);

  return {
    title: data ? `Manage: ${data.tournament.name}` : "Tournament",
    description: "Manage your tournament registrations and participants.",
  };
}

export default async function TournamentManagePage({
  params,
}: {
  params: Promise<{ orgId: string; id: string }>;
}) {
  const { orgId, id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const headersList = await headers();
  const cookieHeader = headersList.get("cookie") ?? "";

  const data = await fetchTournamentManage(orgId, id, cookieHeader);

  if (!data) {
    notFound();
  }

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <TournamentManageClient
        orgId={orgId}
        tournament={data.tournament}
        stats={data.stats}
        participants={data.participants}
      />
    </div>
  );
}
