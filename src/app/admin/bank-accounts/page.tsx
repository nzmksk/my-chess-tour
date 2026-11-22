import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { loadBankNameReviews } from "@/services/payouts/name-review";
import BankNameReviewClient from "./_components/BankNameReviewClient";

export const metadata: Metadata = {
  title: "Bank Account Name Review",
  description:
    "Review payout accounts whose bank holder name doesn't match the recipient.",
};

export default async function AdminBankAccountsPage() {
  const claims = await getAuthClaims();
  if (!claims) redirect("/auth/login");

  const supabase = await createClient();
  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: claims.id, p_permission: "platform.manage" },
  );
  if (permissionError || !isAdmin) redirect("/");

  const { data, error } = await loadBankNameReviews();

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <BankNameReviewClient reviews={data} loadFailed={!!error} />
    </div>
  );
}
