import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { listAdminAwards } from "@/services/prizes/awards";
import AdminPrizesClient from "./_components/AdminPrizesClient";

export const metadata: Metadata = {
  title: "Prizes",
  description: "Review prize winners and send prizes from platform-managed prize pools.",
};

export default async function AdminPrizesPage() {
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

  const result = await listAdminAwards();
  if (!result.ok) {
    redirect("/");
  }

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <AdminPrizesClient awards={result.awards} />
    </div>
  );
}
