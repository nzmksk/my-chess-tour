import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { loadPayoutReview } from "@/services/payouts/review";
import PayoutReviewClient from "./_components/PayoutReviewClient";

export const metadata: Metadata = {
  title: "Payout Review",
  description: "Review an early payout request.",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminPayoutReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    redirect("/admin/payouts");
  }

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

  const { data, error } = await loadPayoutReview(id);
  if (error) {
    console.error(`Admin payout review: failed to load payout ${id}`, error);
  }
  if (!data) {
    redirect("/admin/payouts");
  }

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <PayoutReviewClient review={data} />
    </div>
  );
}
