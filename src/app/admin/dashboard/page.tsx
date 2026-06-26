import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import AdminDashboardClient from "./_components/AdminDashboardClient";

export const metadata: Metadata = {
  title: "Admin Dashboard",
  description: "Platform administration dashboard.",
};

interface AdminDashboardData {
  stats: {
    total_users: number;
    organizations: {
      total: number;
      pending: number;
      approved: number;
      rejected: number;
    };
    tournaments: {
      total: number;
      published: number;
      draft: number;
      cancelled: number;
    };
    total_registrations: number;
    platform_revenue_cents: number;
  };
  pending_organizations: {
    id: string;
    name: string;
    email: string | null;
    created_at: string;
  }[];
  recent_tournaments: {
    id: string;
    name: string;
    organization_name: string | null;
    start_date: string;
    status: string;
    current_participants: number;
    max_participants: number;
  }[];
}

async function fetchAdminDashboard(
  host: string,
  cookieHeader: string,
): Promise<AdminDashboardData | null> {
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(`${protocol}://${host}/api/v1/admin/dashboard`, {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

export default async function AdminDashboardPage() {
  const claims = await getAuthClaims();

  if (!claims) {
    redirect("/auth/login");
  }

  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const cookieHeader = headersList.get("cookie") ?? "";

  const data = await fetchAdminDashboard(host, cookieHeader);

  if (!data) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <AdminDashboardClient data={data} />
    </div>
  );
}
