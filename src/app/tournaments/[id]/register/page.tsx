import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import { computeEntryFeeBreakdown } from "@/services/payments/fees";
import type { TournamentDetail } from "../types";
import type { FeeBreakdownByTier } from "./_components/RegisterForm";
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

  const claims = await getAuthClaims();

  if (!claims) {
    redirect(`/auth/login?next=/tournaments/${id}/register`);
  }

  const supabase = await createClient();
  const { data: playerProfile } = await supabase
    .from("player_profiles")
    .select(
      "gender, is_oku, date_of_birth, title, fide_rating, national_rating",
    )
    .eq("user_id", claims.id)
    .single();

  // Commission rates are server-only; compute the player-facing totals here so
  // the form displays exactly what CHIP will charge (matches the SQL in
  // create_registration_with_payment).
  const { data: commission } = await supabaseAdmin
    .from("tournaments")
    .select("commission_rate, organizer_commission_pct")
    .eq("id", id)
    .single();

  const commissionRate = commission?.commission_rate ?? 10;
  const organizerCommissionPct = commission?.organizer_commission_pct ?? 0;

  const feeBreakdown: FeeBreakdownByTier = {};
  const breakdownFor = (entryCents: number) =>
    computeEntryFeeBreakdown(
      entryCents,
      commissionRate,
      organizerCommissionPct,
    );
  feeBreakdown.standard = breakdownFor(
    tournament.entry_fees.standard.amount_cents,
  );
  for (const tier of tournament.entry_fees.additional ?? []) {
    feeBreakdown[tier.type] = breakdownFor(tier.amount_cents);
  }

  return (
    <Suspense fallback={<RegisterFormSkeleton />}>
      <RegisterForm
        tournament={tournament}
        userId={claims.id}
        playerProfile={playerProfile ?? null}
        feeBreakdown={feeBreakdown}
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
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-2xl px-6 py-10 md:px-10">
        <RegisterPageContent id={id} />
      </main>
    </div>
  );
}
