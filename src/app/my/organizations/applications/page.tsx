import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import ApplicationsClient from "./_components/ApplicationsClient";
import type { OrgApplication } from "./types";

export const metadata: Metadata = {
  title: "My Organizations",
  description: "Track your organizer applications and their review status.",
};

export default async function MyOrganizationsPage() {
  const claims = await getAuthClaims();

  if (!claims) {
    redirect("/auth/login");
  }

  const { data } = await supabaseAdmin
    .from("organizations")
    .select(
      "id, name, approval_status, rejection_reason, created_at, reviewed_at",
    )
    .eq("created_by", claims.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const applications: OrgApplication[] = data ?? [];

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <ApplicationsClient applications={applications} />
    </div>
  );
}
