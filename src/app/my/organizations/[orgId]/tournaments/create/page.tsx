import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { selfApiFetch } from "@/lib/self-fetch";
import { getAuthClaims, hasOrgPermission } from "@/services/supabase/permission";
import { TournamentWizardProvider } from "./_components/TournamentWizardContext";
import WizardShell from "./_components/WizardShell";

export const metadata: Metadata = {
  title: "Create Tournament",
  description: "Create a new chess tournament for your organization.",
};

interface OrgData {
  organization: { id: string; name: string; approval_status: string };
}

async function fetchOrg(orgId: string): Promise<OrgData | null> {
  try {
    const res = await selfApiFetch(`/api/v1/organizations/${orgId}/dashboard`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

export default async function CreateTournamentPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const claims = await getAuthClaims();

  if (!claims) {
    redirect("/auth/login");
  }

  const [data, canNominate] = await Promise.all([
    fetchOrg(orgId),
    hasOrgPermission(claims.id, orgId, "payout.request"),
  ]);

  if (!data) {
    notFound();
  }

  const orgName = data!.organization.name;

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <TournamentWizardProvider orgId={orgId} canNominate={canNominate}>
        <WizardShell orgId={orgId} orgName={orgName} />
      </TournamentWizardProvider>
    </div>
  );
}
