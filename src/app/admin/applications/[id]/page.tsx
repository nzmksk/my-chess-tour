import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import ApplicationDetailClient from "./_components/ApplicationDetailClient";

export const metadata: Metadata = {
  title: "Application Review",
  description: "Review organizer application details.",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface OrgLink {
  label: string;
  url: string;
}

export type OrgLinks = OrgLink[];

export interface PlayerProfile {
  fide_id: number | null;
  fide_rating: { standard?: number; rapid?: number; blitz?: number } | null;
  title: string | null;
  fide_name_verified: boolean | null;
  fide_verified_name: string | null;
}

export interface Applicant {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  created_at: string;
  player_profiles: PlayerProfile | PlayerProfile[] | null;
}

export type OrgEntityType = "company" | "society" | "individual";

/** Masked. The full account number is never sent to the browser. */
export interface ApplicationBankAccount {
  bank_name: string;
  bank_code: string;
  account_holder: string;
  account_number_last4: string;
  status: "pending" | "verified" | "rejected";
  rejection_reason: string | null;
}

export interface ApplicationDocument {
  id: string;
  doc_type: string;
  original_filename: string | null;
  /** Short-lived signed URL, minted server-side. Null if it couldn't be. */
  url: string | null;
}

export interface ApplicationDetail {
  id: string;
  name: string;
  description: string | null;
  links: OrgLinks | null;
  email: string | null;
  phone: string | null;
  past_tournament_refs: string | null;
  entity_type: OrgEntityType | null;
  registration_number: string | null;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  applicant: Applicant | null;
  bank_account: ApplicationBankAccount | null;
  documents: ApplicationDocument[];
}

/**
 * How long a reviewer's document links stay live. Matches the OKU review page.
 * Short on purpose: these are identity documents, and a signed URL that outlives
 * the review is a credential sitting in a browser history.
 */
const DOCUMENT_URL_TTL_SECONDS = 300;

export default async function AdminApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    redirect("/admin/applications");
  }

  const claims = await getAuthClaims();

  if (!claims) {
    redirect("/auth/login");
  }

  const supabase = await createClient();
  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: claims.id, p_permission: "platform.manage" },
  );

  if (permissionError || !isAdmin) {
    redirect("/");
  }

  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select(
      `id, name, description, links, email, phone, past_tournament_refs,
       entity_type, registration_number,
       approval_status, rejection_reason, created_at, reviewed_at,
       applicant:users!created_by(
         id, first_name, last_name, email, created_at,
         player_profiles!user_id(fide_id, fide_rating, title, fide_name_verified, fide_verified_name)
       )`,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    redirect("/admin/applications");
  }

  const [{ data: bankRow }, { data: documentRows }] = await Promise.all([
    supabaseAdmin
      .from("organization_bank_accounts")
      .select(
        "bank_name, bank_code, account_holder, account_number, status, rejection_reason",
      )
      .eq("organization_id", id)
      .eq("is_active", true)
      .maybeSingle(),
    supabaseAdmin
      .from("organization_documents")
      .select("id, doc_type, storage_path, original_filename")
      .eq("organization_id", id)
      .order("created_at", { ascending: true }),
  ]);

  // Masked here, in the server component, so the full number never reaches the
  // client bundle — the same rule the API follows.
  const bankAccount = bankRow
    ? {
        bank_name: bankRow.bank_name,
        bank_code: bankRow.bank_code,
        account_holder: bankRow.account_holder,
        account_number_last4: (bankRow.account_number as string).slice(-4),
        status: bankRow.status,
        rejection_reason: bankRow.rejection_reason,
      }
    : null;

  // The bucket is private, so a path is not a link. Each URL is signed here and
  // expires with the review session.
  const documents = await Promise.all(
    (documentRows ?? []).map(async (doc) => {
      const { data: signed } = await supabaseAdmin.storage
        .from("organization-documents")
        .createSignedUrl(doc.storage_path as string, DOCUMENT_URL_TTL_SECONDS);
      return {
        id: doc.id as string,
        doc_type: doc.doc_type as string,
        original_filename: doc.original_filename as string | null,
        url: signed?.signedUrl ?? null,
      };
    }),
  );

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <ApplicationDetailClient
        application={
          {
            ...data,
            bank_account: bankAccount,
            documents,
          } as unknown as ApplicationDetail
        }
      />
    </div>
  );
}
