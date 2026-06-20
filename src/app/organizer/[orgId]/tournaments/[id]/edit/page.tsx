import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { TournamentWizardProvider } from "@/app/organizer/[orgId]/tournaments/create/_components/TournamentWizardContext";
import type { PersistedState } from "@/app/organizer/[orgId]/tournaments/create/_components/TournamentWizardContext";
import WizardShell from "@/app/organizer/[orgId]/tournaments/create/_components/WizardShell";

export const metadata: Metadata = {
  title: "Edit Tournament",
  description: "Edit your tournament details.",
};

type ApiTierType = "early_bird" | "titled_players" | "rating_based" | "age_based" | "standard";

interface AdditionalTier {
  type: ApiTierType;
  amount_cents: number;
  valid_until?: string;
  titles?: string[];
  rating_from?: number;
  rating_to?: number;
  age_from?: number;
  age_to?: number;
}

interface TournamentForEdit {
  id: string;
  name: string;
  description: string | null;
  status: string;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  venue: { name: string; state: string; address?: string | null };
  format: { type?: string; system?: string; rounds?: number } | null;
  time_control: { base_minutes?: number; increment_seconds?: number; delay_seconds?: number } | null;
  is_fide_rated: boolean;
  is_mcf_rated: boolean;
  max_participants: number;
  entry_fees: {
    standard: { amount_cents: number };
    additional?: AdditionalTier[];
  } | null;
  prizes: {
    categories?: Array<{ name: string; entries: Array<{ placement: string; amount_cents: number }> }>;
    special?: Array<{ name: string; amount_cents: number }>;
  } | null;
  restrictions: Array<{ type: string; value: string }> | null;
}

async function fetchTournamentForEdit(
  orgId: string,
  id: string,
  cookieHeader: string,
): Promise<TournamentForEdit | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  try {
    const res = await fetch(
      `${baseUrl}/api/v1/organizer/${orgId}/tournaments/${id}`,
      { cache: "no-store", headers: { cookie: cookieHeader } },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return (json.data?.tournament as TournamentForEdit) ?? null;
  } catch {
    return null;
  }
}

function toLocalDatetimeString(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mapApiTierType(type: ApiTierType): "early-bird" | "titled" | "rating-based" | "age-based" {
  switch (type) {
    case "early_bird": return "early-bird";
    case "titled_players": return "titled";
    case "rating_based": return "rating-based";
    case "age_based": return "age-based";
    default: return "early-bird";
  }
}

function buildInitialData(t: TournamentForEdit, orgId: string): PersistedState {
  const basicInfoData = {
    name: t.name,
    description: t.description ?? "",
    venueName: t.venue.name,
    venueState: t.venue.state,
    venueAddress: t.venue.address ?? "",
  };

  const restrictions = (t.restrictions ?? []).map((r, idx) => ({
    id: `r-${idx}`,
    type: r.type,
    value: r.value,
  }));

  const formatData = {
    formatType: t.format?.type
      ? t.format.type.charAt(0).toUpperCase() + t.format.type.slice(1)
      : "",
    system: t.format?.system
      ? t.format.system.charAt(0).toUpperCase() + t.format.system.slice(1)
      : "",
    rounds: t.format?.rounds ?? ("" as const),
    baseTime: t.time_control?.base_minutes ?? ("" as const),
    increment: t.time_control?.increment_seconds ?? 0,
    delay: t.time_control?.delay_seconds ?? 0,
    startDate: t.start_date,
    endDate: t.end_date,
    registrationDeadline: toLocalDatetimeString(t.registration_deadline),
    maxParticipants: t.max_participants,
    fideRated: t.is_fide_rated,
    mcfRated: t.is_mcf_rated,
    restrictions,
  };

  const additionalTiers = (t.entry_fees?.additional ?? [])
    .filter((tier) => tier.type !== "standard")
    .map((tier, idx) => ({
      id: `tier-${idx}`,
      type: mapApiTierType(tier.type),
      amount: tier.amount_cents / 100,
      validUntil: tier.valid_until ?? "",
      titles: tier.titles ?? [],
      ratingFrom: tier.rating_from ?? ("" as const),
      ratingTo: tier.rating_to ?? ("" as const),
      ageFrom: tier.age_from ?? ("" as const),
      ageTo: tier.age_to ?? ("" as const),
    }));

  const feesData = {
    standardFee: t.entry_fees?.standard
      ? t.entry_fees.standard.amount_cents / 100
      : ("" as const),
    tiers: additionalTiers,
  };

  const prizeCategories = (t.prizes?.categories ?? []).map((cat, ci) => ({
    id: `cat-${ci}`,
    name: cat.name,
    prizes: cat.entries.map((e, ei) => ({
      id: `prize-${ci}-${ei}`,
      placement: e.placement,
      amount: e.amount_cents / 100,
    })),
  }));

  const specialPrizes = (t.prizes?.special ?? []).map((sp, si) => ({
    id: `sp-${si}`,
    name: sp.name,
    amount: sp.amount_cents / 100,
  }));

  const prizesData = {
    categories: prizeCategories,
    specialPrizes,
  };

  return {
    basicInfoData,
    formatData,
    feesData,
    prizesData,
    tournamentId: t.id,
    currentStepIndex: 0,
    completedSteps: [],
  };
}

async function fetchOrgName(
  orgId: string,
  cookieHeader: string,
): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${baseUrl}/api/v1/organizer/${orgId}/dashboard`, {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    });
    if (!res.ok) return "Organization";
    const json = await res.json();
    return (json.data?.organization?.name as string) ?? "Organization";
  } catch {
    return "Organization";
  }
}

export default async function EditTournamentPage({
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

  const [tournament, orgName] = await Promise.all([
    fetchTournamentForEdit(orgId, id, cookieHeader),
    fetchOrgName(orgId, cookieHeader),
  ]);

  if (!tournament) {
    notFound();
  }

  const initialData = buildInitialData(tournament, orgId);

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <TournamentWizardProvider
        orgId={orgId}
        initialData={initialData}
        storageKeySuffix={`edit-${id}`}
        excludeId={id}
      >
        <WizardShell
          orgId={orgId}
          orgName={orgName}
          title="Edit Tournament"
          redirectPath={`/organizer/${orgId}/tournaments/${id}`}
          mode="edit"
        />
      </TournamentWizardProvider>
    </div>
  );
}
