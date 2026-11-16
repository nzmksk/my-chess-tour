import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { loadStuckRefunds } from "@/services/refunds/stuck";
import StuckRefundsClient from "./_components/StuckRefundsClient";

export const metadata: Metadata = {
  title: "Stuck refunds",
  description: "Refunds still owed to players that nothing is moving.",
};

export default async function AdminRefundsPage() {
  const claims = await getAuthClaims();
  if (!claims) {
    redirect("/auth/login");
  }

  // Repeated inline on every admin page: there is no src/app/admin/layout.tsx.
  const supabase = await createClient();
  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: claims.id, p_permission: "platform.manage" },
  );

  if (permissionError || !isAdmin) {
    redirect("/");
  }

  const { data, error } = await loadStuckRefunds();

  if (error || !data) {
    redirect("/");
  }

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <StuckRefundsClient refunds={data} />
    </div>
  );
}
