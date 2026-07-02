import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import OkuListClient from "./_components/OkuListClient";

export const metadata: Metadata = {
  title: "OKU Verification",
  description: "Review OKU verification submissions.",
};

export type OkuReviewStatus = "pending" | "verified" | "rejected";

export interface OkuSubmission {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  oku_status: OkuReviewStatus;
  submitted_at: string;
  reviewed_at: string | null;
}

export interface OkuCounts {
  pending: number;
  verified: number;
  rejected: number;
  total: number;
}

export default async function AdminOkuPage() {
  const claims = await getAuthClaims();
  if (!claims) redirect("/auth/login");

  const supabase = await createClient();
  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: claims.id, p_permission: "platform.manage" },
  );
  if (permissionError || !isAdmin) redirect("/");

  const { data: profiles, error } = await supabaseAdmin
    .from("player_profiles")
    .select("user_id, oku_status, oku_reviewed_at, updated_at")
    .neq("oku_status", "none")
    .order("updated_at", { ascending: false });

  if (error) redirect("/");

  const rows = profiles ?? [];
  const userIds = rows.map((r) => r.user_id);

  const usersById = new Map<
    string,
    { first_name: string; last_name: string; email: string }
  >();
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id, first_name, last_name, email")
      .in("id", userIds);
    for (const u of users ?? []) {
      usersById.set(u.id, {
        first_name: u.first_name,
        last_name: u.last_name,
        email: u.email,
      });
    }
  }

  const submissions: OkuSubmission[] = rows.map((r) => {
    const u = usersById.get(r.user_id);
    return {
      user_id: r.user_id,
      first_name: u?.first_name ?? "",
      last_name: u?.last_name ?? "",
      email: u?.email ?? "",
      oku_status: r.oku_status as OkuReviewStatus,
      submitted_at: r.updated_at,
      reviewed_at: r.oku_reviewed_at,
    };
  });

  const counts: OkuCounts = {
    pending: submissions.filter((s) => s.oku_status === "pending").length,
    verified: submissions.filter((s) => s.oku_status === "verified").length,
    rejected: submissions.filter((s) => s.oku_status === "rejected").length,
    total: submissions.length,
  };

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <OkuListClient data={{ counts, submissions }} />
    </div>
  );
}
