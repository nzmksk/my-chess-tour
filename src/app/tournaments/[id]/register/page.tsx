import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import type { TournamentDetail } from "../types";
import RegisterForm from "./_components/RegisterForm";
import RegisterFormSkeleton from "./_components/RegisterFormSkeleton";

export const dynamic = "force-dynamic";

async function fetchTournament(id: string): Promise<TournamentDetail | null> {
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(`${protocol}://${host}/api/v1/tournaments/${id}`, {
      cache: "no-store",
    });
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
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tournament = await fetchTournament(id);
  if (!tournament) return { title: "Tournament Not Found" };
  return {
    title: `Register – ${tournament.name} | MY Chess Tour`,
  };
}

async function RegisterPageContent({ id }: { id: string }) {
  const tournament = await fetchTournament(id);
  if (!tournament) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/login?next=/tournaments/${id}/register`);
  }

  const { data: playerProfile } = await supabase
    .from("player_profiles")
    .select("gender, is_oku, date_of_birth, title")
    .eq("user_id", user.id)
    .single();

  return (
    <Suspense fallback={<RegisterFormSkeleton />}>
      <RegisterForm
        tournament={tournament}
        userId={user.id}
        playerProfile={playerProfile ?? null}
      />
    </Suspense>
  );
}

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <main className="max-w-2xl mx-auto px-6 md:px-10 py-10">
        <RegisterPageContent id={id} />
      </main>
    </div>
  );
}
