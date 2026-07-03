import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import OkuReviewClient from "./_components/OkuReviewClient";

export const metadata: Metadata = {
  title: "OKU Review",
  description: "Review an OKU verification submission.",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OkuReviewStatus = "pending" | "verified" | "rejected";

export interface OkuReview {
  user_id: string;
  name: string;
  email: string;
  oku_status: OkuReviewStatus;
  oku_rejection_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  document_url: string | null;
}

export default async function AdminOkuDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  if (!UUID_RE.test(userId)) redirect("/admin/oku");

  const claims = await getAuthClaims();
  if (!claims) redirect("/auth/login");

  const supabase = await createClient();
  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: claims.id, p_permission: "platform.manage" },
  );
  if (permissionError || !isAdmin) redirect("/");

  const { data: profile } = await supabaseAdmin
    .from("player_profiles")
    .select(
      "user_id, oku_status, oku_document_path, oku_rejection_reason, oku_reviewed_at, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile || profile.oku_status === "none") redirect("/admin/oku");

  const { data: userRow } = await supabaseAdmin
    .from("users")
    .select("first_name, last_name, email")
    .eq("id", userId)
    .maybeSingle();

  let documentUrl: string | null = null;
  if (profile.oku_document_path) {
    const { data: signed } = await supabaseAdmin.storage
      .from("oku-documents")
      .createSignedUrl(profile.oku_document_path, 300);
    documentUrl = signed?.signedUrl ?? null;
  }

  const review: OkuReview = {
    user_id: profile.user_id,
    name: `${userRow?.first_name ?? ""} ${userRow?.last_name ?? ""}`.trim(),
    email: userRow?.email ?? "",
    oku_status: profile.oku_status as OkuReviewStatus,
    oku_rejection_reason: profile.oku_rejection_reason,
    submitted_at: profile.updated_at,
    reviewed_at: profile.oku_reviewed_at,
    document_url: documentUrl,
  };

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <OkuReviewClient review={review} />
    </div>
  );
}
