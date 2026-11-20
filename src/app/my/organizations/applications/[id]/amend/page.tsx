import type { Metadata } from "next";
import { redirect } from "next/navigation";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import ApplyForm, {
  type AmendApplication,
} from "@/app/organizations/apply/_components/ApplyForm";

export const metadata: Metadata = {
  title: "Amend Application | MY Chess Tour",
};

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const APPLICATIONS_PATH = "/my/organizations/applications";

/**
 * The applicant amends their rejected organizer application and resubmits it
 * (#582). Only their own application, and only while it is rejected: anything
 * else goes back to the applications list.
 */
export default async function AmendApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const claims = await getAuthClaims();
  if (!claims) {
    redirect(
      `/auth/login?redirectTo=${APPLICATIONS_PATH}/${id}/amend&message=login-required`,
    );
  }

  if (!UUID_RE.test(id)) {
    redirect(APPLICATIONS_PATH);
  }

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select(
      `id, name, description, links, email, phone, past_tournament_refs,
       entity_type, registration_number, approval_status, rejection_reason`,
    )
    .eq("id", id)
    .eq("created_by", claims.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!org || org.approval_status !== "rejected") {
    redirect(APPLICATIONS_PATH);
  }

  const [{ data: bankRow }, { data: documentRows }] = await Promise.all([
    supabaseAdmin
      .from("organization_bank_accounts")
      .select("bank_name, bank_code, account_holder, account_number")
      .eq("organization_id", id)
      // Rejecting deactivated it, so the newest row rather than the active one.
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("organization_documents")
      .select("id, doc_type, original_filename")
      .eq("organization_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const amend: AmendApplication = {
    id: org.id,
    rejectionReason: org.rejection_reason,
    name: org.name,
    description: org.description,
    links: org.links,
    email: org.email,
    phone: org.phone,
    pastTournamentRefs: org.past_tournament_refs,
    entityType: org.entity_type,
    registrationNumber: org.registration_number,
    // Masked here, in the server component: the full number never reaches the
    // browser. Keeping the account re-registers it from the database.
    bank: bankRow
      ? {
          bankName: bankRow.bank_name,
          bankCode: bankRow.bank_code,
          accountHolder: bankRow.account_holder,
          last4: (bankRow.account_number as string).slice(-4),
        }
      : null,
    documents: (documentRows ?? []).map((doc) => ({
      id: doc.id as string,
      docType: doc.doc_type as string,
      originalFilename: doc.original_filename as string | null,
    })),
  };

  return (
    <div className="bg-bg-base flex-1">
      <NavBar />
      <main className="mx-auto max-w-2xl px-6 py-10 md:px-10">
        <ApplyForm amend={amend} />
      </main>
    </div>
  );
}
