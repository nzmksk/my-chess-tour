import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import { computeEntryFeeBreakdown } from "@/services/payments/fees";
import { normalizeRestrictions } from "@/app/api/v1/tournaments/[slug]/registrations/validators";
import { PAYMENT_TIMEOUT_MINUTES } from "@/services/chip/chip";
import type { TournamentDetail } from "../types";
import type { FeeBreakdownByTier } from "./_components/RegisterForm";
import RegisterForm from "./_components/RegisterForm";
import RegisterFormSkeleton from "./_components/RegisterFormSkeleton";
import PaymentInProgress from "./_components/PaymentInProgress";
import ParticipantPicker from "./_components/ParticipantPicker";
import { loadRegisterParticipants } from "./_lib/participant";

export const dynamic = "force-dynamic";

async function fetchTournament(slug: string): Promise<TournamentDetail | null> {
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(
      `${protocol}://${host}/api/v1/tournaments/${slug}`,
      {
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

// Resolves a still-live pending payment (within the seat hold) into the props
// for the Continue-payment screen, or null if the user should see the normal
// form. Kept out of the component body so the time check stays out of render.
async function getLivePendingPayment(
  userId: string,
  payerId: string,
  tournamentId: string,
  feeBreakdown: FeeBreakdownByTier,
): Promise<{
  feeTier: string;
  grossCents: number;
  checkoutUrl: string;
  unlockAt: string;
} | null> {
  const { data: existingReg } = await supabaseAdmin
    .from("registrations")
    .select("id, status, fee_tier, registered_at, current_payment_id")
    .eq("user_id", userId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (
    existingReg?.status !== "pending_payment" ||
    !existingReg.current_payment_id ||
    Date.now() - new Date(existingReg.registered_at).getTime() >=
      PAYMENT_TIMEOUT_MINUTES * 60_000
  ) {
    return null;
  }

  // Reuse the current attempt's stored link.
  const { data: payment } = await supabaseAdmin
    .from("payments")
    .select("checkout_url, user_id")
    .eq("id", existingReg.current_payment_id)
    .maybeSingle();

  if (!payment?.checkout_url) return null;
  if (payment.user_id && payment.user_id !== payerId) return null;

  return {
    feeTier: existingReg.fee_tier,
    grossCents: feeBreakdown[existingReg.fee_tier]?.gross_cents ?? 0,
    checkoutUrl: payment.checkout_url,
    unlockAt: new Date(
      new Date(existingReg.registered_at).getTime() +
        PAYMENT_TIMEOUT_MINUTES * 60_000,
    ).toISOString(),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tournament = await fetchTournament(slug);
  if (!tournament) return { title: "Tournament Not Found" };
  return {
    title: `Register – ${tournament.name} | MY Chess Tour`,
  };
}

async function RegisterPageContent({
  slug,
  requestedParticipant,
}: {
  slug: string;
  requestedParticipant: string | undefined;
}) {
  const tournament = await fetchTournament(slug);
  if (!tournament) notFound();

  // The slug resolved to a tournament; use its UUID for all internal queries.
  const tournamentId = tournament.id;

  const claims = await getAuthClaims();

  if (!claims) {
    redirect(`/auth/login?next=/tournaments/${slug}/register`);
  }

  const choice = await loadRegisterParticipants(
    claims.id,
    requestedParticipant,
  );
  if (!choice.ok) {
    console.error(
      "Register page: failed to load the caller's dependents",
      choice.error,
    );
  }
  const pickerOptions = choice.ok ? choice.options : [];
  const participant = choice.ok
    ? choice.selected
    : requestedParticipant && requestedParticipant !== claims.id
      ? null
      : { id: claims.id, firstName: "You", name: "Myself", isSelf: true };
  if (!participant) {
    redirect(`/tournaments/${slug}/register`);
  }

  const supabase = await createClient();
  const { data: playerProfile } = await supabase
    .from("player_profiles")
    .select(
      "gender, oku_status, date_of_birth, title, fide_rating, national_rating, fide_id, mcf_id, nationality",
    )
    .eq("user_id", participant.id)
    .single();

  // Commission rates are server-only; compute the player-facing totals here so
  // the form displays exactly what CHIP will charge (matches the SQL in
  // create_registration_with_payment).
  const { data: commission } = await supabaseAdmin
    .from("tournaments")
    .select("commission_rate, organizer_commission_pct")
    .eq("id", tournamentId)
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

  // If the user has a still-live pending payment, resuming reuses the same CHIP
  // link with the tier locked — so show a "Continue payment" screen instead of
  // the tier form. Once the hold lapses the row expires and the form returns.
  const livePending = await getLivePendingPayment(
    participant.id,
    claims.id,
    tournamentId,
    feeBreakdown,
  );

  const picker =
    pickerOptions.length > 1 ? (
      <ParticipantPicker
        participants={pickerOptions}
        selectedId={participant.id}
      />
    ) : null;

  if (livePending) {
    return (
      <>
        {picker}
        <PaymentInProgress tournamentSlug={slug} {...livePending} />
      </>
    );
  }

  return (
    <>
      {picker}
      <Suspense fallback={<RegisterFormSkeleton />}>
        <RegisterForm
          key={participant.id}
          tournament={tournament}
          userId={claims.id}
          playerProfile={playerProfile ?? null}
          restrictions={normalizeRestrictions(tournament.restrictions)}
          feeBreakdown={feeBreakdown}
          participant={participant}
        />
      </Suspense>
    </>
  );
}

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ participant?: string | string[] }>;
}) {
  const { slug } = await params;
  const { participant } = await searchParams;

  return (
    <div className="bg-bg-base flex-1">
      <NavBar />
      <main className="mx-auto max-w-2xl px-6 py-10 md:px-10">
        <RegisterPageContent
          slug={slug}
          requestedParticipant={
            typeof participant === "string" ? participant : undefined
          }
        />
      </main>
    </div>
  );
}
