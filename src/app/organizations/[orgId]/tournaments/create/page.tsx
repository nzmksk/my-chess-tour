import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { TournamentWizardProvider } from "./_components/TournamentWizardContext";
import WizardShell from "./_components/WizardShell";

export const metadata: Metadata = {
  title: "Create Tournament",
  description: "Create a new chess tournament for your organization.",
};

interface OrgData {
  organization: { id: string; name: string; approval_status: string };
}

async function fetchOrg(
  orgId: string,
  cookieHeader: string,
): Promise<OrgData | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  try {
    const res = await fetch(
      `${baseUrl}/api/v1/organizations/${orgId}/dashboard`,
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

export default async function CreateTournamentPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const headersList = await headers();
  const cookieHeader = headersList.get("cookie") ?? "";

  const data = await fetchOrg(orgId, cookieHeader);

  if (!data) {
    notFound();
  }

  const orgName = data!.organization.name;

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <TournamentWizardProvider orgId={orgId}>
        <WizardShell orgId={orgId} orgName={orgName} />
      </TournamentWizardProvider>
    </div>
  );
}
