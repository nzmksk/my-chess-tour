import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import ProfileClient from "./_components/ProfileClient";
import type { PlayerProfile } from "@/app/profile/types";

export const metadata: Metadata = {
  title: "Settings",
  description: "View and edit your chess player profile.",
};

async function fetchProfile(
  host: string,
  cookieHeader: string,
): Promise<PlayerProfile | null> {
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(`${protocol}://${host}/api/v1/profile`, {
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

export default async function SettingsPage() {
  const claims = await getAuthClaims();

  if (!claims) {
    redirect("/auth/login");
  }

  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const cookieHeader = headersList.get("cookie") ?? "";
  const profile = await fetchProfile(host, cookieHeader);

  if (!profile) {
    redirect("/auth/login");
  }

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <ProfileClient profile={profile} />
    </div>
  );
}
