import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import RegistrationsClient from "./_components/RegistrationsClient";
import type { PlayerRegistration } from "./types";

export const metadata: Metadata = {
  title: "My Tournaments",
  description: "View and manage your chess tournament registrations.",
};

async function fetchRegistrations(
  host: string,
  cookieHeader: string,
): Promise<PlayerRegistration[]> {
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  try {
    const res = await fetch(
      `${protocol}://${host}/api/v1/me/registrations?sort=registered_at&order=desc`,
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

export default async function PlayerRegistrationsPage() {
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
  const registrations = await fetchRegistrations(host, cookieHeader);

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <RegistrationsClient registrations={registrations} />
    </div>
  );
}
