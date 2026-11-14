import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { selfApiFetch } from "@/lib/http/self-fetch";
import { getAuthClaims } from "@/services/supabase/permission";
import DashboardClient from "./_components/DashboardClient";
import type { PendingNomination } from "./_components/PendingNominations";

export const metadata: Metadata = {
  title: "Organizer Dashboard",
  description: "Manage your organization, tournaments, and registrations.",
};

interface DashboardData {
  organization: {
    id: string;
    name: string;
    approval_status: string;
    agreement_version: string | null;
  };
  // NULL when the organization has no active bank account. Typed here as well
  // as in DashboardClient so that dropping it from the API payload breaks the
  // build instead of silently rendering the "no bank account" banner.
  bank_account: {
    status: "pending" | "verified" | "rejected";
    rejection_reason: string | null;
  } | null;
  stats: {
    active_tournaments: number;
    total_registrations: number;
    total_revenue_cents: number;
    pending_payout_cents: number;
  };
  recent_tournaments: {
    id: string;
    name: string;
    start_date: string;
    current_participants: number;
    max_participants: number;
    status: "draft" | "published" | "ongoing" | "completed" | "cancelled";
  }[];
}

async function fetchDashboard(orgId: string): Promise<DashboardData | null> {
  try {
    const res = await selfApiFetch(`/api/v1/organizations/${orgId}/dashboard`);
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 401) return null;
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

// Best-effort, and gated on payout.request: anyone who can't accept a nomination
// gets a 403 here, which simply means no panel.
async function fetchPendingNominations(orgId: string): Promise<PendingNomination[]> {
  try {
    const res = await selfApiFetch(`/api/v1/organizations/${orgId}/nominations`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

export default async function OrganizerDashboardPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const claims = await getAuthClaims();

  if (!claims) {
    redirect("/auth/login");
  }

  const [data, pendingNominations] = await Promise.all([
    fetchDashboard(orgId),
    fetchPendingNominations(orgId),
  ]);

  if (!data) {
    notFound();
  }

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <DashboardClient data={data} pendingNominations={pendingNominations} />
    </div>
  );
}
