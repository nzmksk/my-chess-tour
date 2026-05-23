import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import ApplicationsClient from "./_components/ApplicationsClient";
import type { OrgApplication } from "./types";

export const metadata: Metadata = {
  title: "My Organizations",
  description: "Track your organizer applications and their review status.",
};

async function fetchApplications(
  host: string,
  cookieHeader: string,
): Promise<OrgApplication[]> {
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(
      `${protocol}://${host}/api/v1/organizations/applications`,
      {
        cache: "no-store",
        headers: { cookie: cookieHeader },
      },
    );
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

export default async function MyOrganizationsPage() {
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
  const applications = await fetchApplications(host, cookieHeader);

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <ApplicationsClient applications={applications} />
    </div>
  );
}
