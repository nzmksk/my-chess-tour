import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import ApplicationDetailClient from "./_components/ApplicationDetailClient";

export const metadata: Metadata = {
  title: "Application Review",
  description: "Review organizer application details.",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface OrgLink {
  label: string;
  url: string;
}

export type OrgLinks = OrgLink[];

export interface PlayerProfile {
  fide_id: number | null;
  fide_rating: { standard?: number; rapid?: number; blitz?: number } | null;
  title: string | null;
}

export interface Applicant {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  created_at: string;
  player_profiles: PlayerProfile | PlayerProfile[] | null;
}

export interface ApplicationDetail {
  id: string;
  name: string;
  description: string | null;
  links: OrgLinks | null;
  email: string | null;
  phone: string | null;
  past_tournament_refs: string | null;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  applicant: Applicant | null;
}

export default async function AdminApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    redirect("/admin/applications");
  }

  const claims = await getAuthClaims();

  if (!claims) {
    redirect("/auth/login");
  }

  const supabase = await createClient();
  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: claims.id, p_permission: "platform.manage" },
  );

  if (permissionError || !isAdmin) {
    redirect("/");
  }

  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select(
      `id, name, description, links, email, phone, past_tournament_refs,
       approval_status, rejection_reason, created_at, reviewed_at,
       applicant:users!created_by(
         id, first_name, last_name, email, created_at,
         player_profiles(fide_id, fide_rating, title)
       )`,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    redirect("/admin/applications");
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <ApplicationDetailClient application={data as unknown as ApplicationDetail} />
    </div>
  );
}
