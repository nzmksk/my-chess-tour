import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import ApplicationsClient from "./_components/ApplicationsClient";

export const metadata: Metadata = {
  title: "Organizer Applications",
  description: "Review and manage organizer applications.",
};

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Application {
  id: string;
  name: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface ApplicationCounts {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

interface ApplicationsData {
  counts: ApplicationCounts;
  applications: Application[];
}

export default async function AdminApplicationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: user.id, p_permission: "platform.manage" },
  );

  if (permissionError || !isAdmin) {
    redirect("/");
  }

  const { data: rows, error } = await supabaseAdmin
    .from("organizations")
    .select(
      "id, name, description, email, phone, approval_status, rejection_reason, created_at, reviewed_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    redirect("/");
  }

  const applications = (rows ?? []) as Application[];

  const data: ApplicationsData = {
    counts: {
      pending: applications.filter((a) => a.approval_status === "pending").length,
      approved: applications.filter((a) => a.approval_status === "approved").length,
      rejected: applications.filter((a) => a.approval_status === "rejected").length,
      total: applications.length,
    },
    applications,
  };

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <ApplicationsClient data={data} />
    </div>
  );
}
