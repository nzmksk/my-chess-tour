import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import MembersClient from "./_components/MembersClient";

export const metadata: Metadata = {
  title: "Organization Members",
  description: "View and manage your organization's members.",
};

interface Member {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  role: string;
  joined_at: string;
}

interface MembersData {
  members: Member[];
  orgName: string;
  isOrgCreator: boolean;
}

async function fetchMembers(
  orgId: string,
  host: string,
  cookieHeader: string,
): Promise<MembersData | null> {
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const [membersRes, dashboardRes] = await Promise.all([
      fetch(`${protocol}://${host}/api/v1/organizer/${orgId}/members`, {
        cache: "no-store",
        headers: { cookie: cookieHeader },
      }),
      fetch(`${protocol}://${host}/api/v1/organizer/${orgId}/dashboard`, {
        cache: "no-store",
        headers: { cookie: cookieHeader },
      }),
    ]);

    if (
      membersRes.status === 404 ||
      membersRes.status === 403 ||
      membersRes.status === 401 ||
      !membersRes.ok
    ) {
      return null;
    }

    const membersJson = await membersRes.json();
    const members: Member[] = membersJson.data ?? [];
    const isOrgCreator: boolean = membersJson.isOrgCreator ?? false;

    let orgName = "Organization";
    if (dashboardRes.ok) {
      const dashJson = await dashboardRes.json();
      orgName = dashJson.data?.organization?.name ?? orgName;
    }

    return { members, orgName, isOrgCreator };
  } catch {
    return null;
  }
}

export default async function OrganizerMembersPage({
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

  const data = await fetchMembers(orgId, host, cookieHeader);

  if (!data) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <MembersClient
        orgId={orgId}
        orgName={data.orgName}
        members={data.members}
        currentUserId={user.id}
        isOrgCreator={data.isOrgCreator}
      />
    </div>
  );
}
