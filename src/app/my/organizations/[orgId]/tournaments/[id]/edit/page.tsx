import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import { TournamentWizardProvider } from "@/app/my/organizations/[orgId]/tournaments/create/_components/TournamentWizardContext";
import type {
  PersistedRestriction,
  PersistedState,
  StoredEntryFees,
} from "@/app/my/organizations/[orgId]/tournaments/create/types";
import WizardShell from "@/app/my/organizations/[orgId]/tournaments/create/_components/WizardShell";
import { fromPersistedRestrictions } from "@/app/my/organizations/[orgId]/tournaments/create/_components/restrictions";
import { fromPersistedEntryFees } from "@/app/my/organizations/[orgId]/tournaments/create/_components/entryFees";
import { resolveTimeZone, toLocalDateTimeInput } from "@/lib/datetime";
import { DEFAULT_COUNTRY_CODE } from "@/lib/venues";
import {
  isPrizeDistribution,
  isPrizeFundingSource,
  type PrizesJson,
} from "@/lib/prize-funding";

export const metadata: Metadata = {
  title: "Edit Tournament",
  description: "Edit your tournament details.",
};

interface TournamentForEdit {
  id: string;
  name: string;
  description: string | null;
  status: string;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  venue: {
    name: string;
    state: string;
    address?: string | null;
    country?: string | null;
  };
  timezone: string;
  format: { type?: string; system?: string; rounds?: number } | null;
  time_control: {
    base_minutes?: number;
    increment_seconds?: number;
    delay_seconds?: number;
  } | null;
  is_fide_rated: boolean;
  is_mcf_rated: boolean;
  max_participants: number;
  entry_fees: StoredEntryFees | null;
  prizes: PrizesJson | null;
  restrictions: PersistedRestriction[] | null;
}

async function fetchTournamentForEdit(
  orgId: string,
  id: string,
  cookieHeader: string,
): Promise<TournamentForEdit | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  try {
    const res = await fetch(
      `${baseUrl}/api/v1/organizations/${orgId}/tournaments/${id}`,
      { cache: "no-store", headers: { cookie: cookieHeader } },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return (json.data?.tournament as TournamentForEdit) ?? null;
  } catch {
    return null;
  }
}

function buildInitialData(t: TournamentForEdit): PersistedState {
  // Times come back as instants; the organizer edits them at the venue's wall
  // clock, which is the one they entered — not the clock of whoever is editing.
  const timeZone = resolveTimeZone(t.timezone);

  const basicInfoData = {
    name: t.name,
    description: t.description ?? "",
    venueName: t.venue.name,
    venueState: t.venue.state,
    venueAddress: t.venue.address ?? "",
    venueCountry: t.venue.country ?? DEFAULT_COUNTRY_CODE,
    timezone: timeZone,
  };

  const restrictions = fromPersistedRestrictions(t.restrictions ?? []);

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
    registrationDeadline: toLocalDateTimeInput(
      t.registration_deadline,
      timeZone,
    ),
    maxParticipants: t.max_participants,
    fideRated: t.is_fide_rated,
    mcfRated: t.is_mcf_rated,
    restrictions,
  };

  const feesData = fromPersistedEntryFees(t.entry_fees, timeZone);

  const prizeCategories = (t.prizes?.categories ?? []).map((cat, ci) => ({
    id: `cat-${ci}`,
    name: cat.name ?? "",
    prizes: (cat.entries ?? []).map((e, ei) => ({
      id: `prize-${ci}-${ei}`,
      placement: e.place ?? "",
      amount: (e.amount_cents ?? 0) / 100,
    })),
    // Tournaments created before funding was declarable have no `funding`;
    // they hydrate as unselected and must pick a source before re-publishing.
    fundingSource: isPrizeFundingSource(cat.funding?.source)
      ? cat.funding.source
      : ("" as const),
    funderName: cat.funding?.funder_name ?? "",
  }));

  const specialPrizes = (t.prizes?.special ?? []).map((sp, si) => ({
    id: `sp-${si}`,
    name: sp.name ?? "",
    amount: (sp.amount_cents ?? 0) / 100,
    fundingSource: isPrizeFundingSource(sp.funding?.source)
      ? sp.funding.source
      : ("" as const),
    funderName: sp.funding?.funder_name ?? "",
  }));

  const prizesData = {
    categories: prizeCategories,
    specialPrizes,
    distribution: isPrizeDistribution(t.prizes?.distribution)
      ? t.prizes.distribution
      : ("organizer" as const),
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
    const res = await fetch(
      `${baseUrl}/api/v1/organizations/${orgId}/dashboard`,
      {
        cache: "no-store",
        headers: { cookie: cookieHeader },
      },
    );
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

  const claims = await getAuthClaims();

  if (!claims) {
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

  const initialData = buildInitialData(tournament);

  return (
    <div className="bg-bg-base min-h-screen">
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
          redirectPath={`/my/organizations/${orgId}/tournaments/${id}`}
          mode="edit"
        />
      </TournamentWizardProvider>
    </div>
  );
}
