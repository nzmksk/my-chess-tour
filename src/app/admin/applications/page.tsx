import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
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

async function fetchApplications(
  host: string,
  cookieHeader: string,
): Promise<ApplicationsData | null> {
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(
      `${protocol}://${host}/api/v1/admin/applications`,
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

export default async function AdminApplicationsPage() {
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

  const data = await fetchApplications(host, cookieHeader);

  if (!data) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <ApplicationsClient data={data} />
    </div>
  );
}
