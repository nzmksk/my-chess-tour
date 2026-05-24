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
  host: string,
  cookieHeader: string,
): Promise<OrgData | null> {
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(
      `${protocol}://${host}/api/v1/organizer/${orgId}/dashboard`,
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
  const host = headersList.get("host") ?? "localhost:3000";
  const cookieHeader = headersList.get("cookie") ?? "";

  const data = await fetchOrg(orgId, host, cookieHeader);

  if (!data) {
    notFound();
  }

  const orgName = data!.organization.name;

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <TournamentWizardProvider>
        <WizardShell orgId={orgId} orgName={orgName} />
      </TournamentWizardProvider>
    </div>
  );
}
