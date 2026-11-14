import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { selfApiFetch } from "@/lib/http/self-fetch";
import { getAuthClaims } from "@/services/supabase/permission";
import PayoutsClient, { type PayoutsData } from "./_components/PayoutsClient";

export const metadata: Metadata = {
  title: "Payouts",
  description: "What your organization has earned and been paid.",
};

export default async function OrganizationPayoutsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const claims = await getAuthClaims();
  if (!claims) {
    redirect("/auth/login");
  }

  const res = await selfApiFetch(`/api/v1/organizations/${orgId}/payouts`);

  // The dashboard's Pending Payout stat links here for every member, but only
  // owners and admins hold payout.view. Back to the dashboard, not a 404.
  if (!res.ok) {
    redirect(`/my/organizations/${orgId}`);
  }

  const json = (await res.json()) as { data: PayoutsData };

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <PayoutsClient orgId={orgId} data={json.data} />
    </div>
  );
}
