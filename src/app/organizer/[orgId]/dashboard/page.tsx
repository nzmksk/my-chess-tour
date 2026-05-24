import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import DashboardClient from "./_components/DashboardClient";

export const metadata: Metadata = {
  title: "Organizer Dashboard",
  description: "Manage your organization, tournaments, and registrations.",
};

interface DashboardData {
  organization: { id: string; name: string; approval_status: string };
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
    status: string;
  }[];
}

async function fetchDashboard(
  orgId: string,
  host: string,
  cookieHeader: string,
): Promise<DashboardData | null> {
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
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 401) return null;
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

export default async function OrganizerDashboardPage({
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

  const data = await fetchDashboard(orgId, host, cookieHeader);

  if (!data) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <DashboardClient data={data} />
    </div>
  );
}
