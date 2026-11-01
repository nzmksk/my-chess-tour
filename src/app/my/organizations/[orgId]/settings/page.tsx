import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import OrgSettingsClient from "./_components/OrgSettingsClient";

export const metadata: Metadata = {
  title: "Organization Settings",
  description:
    "Manage your organization's profile, payout bank account and verification.",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OrgProfile {
  id: string;
  name: string;
  description: string | null;
  links: { label: string; url: string }[] | null;
  email: string | null;
  phone: string | null;
  past_tournament_refs: string | null;
  avatar_url: string | null;
  entity_type: "company" | "society" | "individual" | null;
  registration_number: string | null;
}

export interface MaskedBankAccount {
  bank_name: string;
  bank_code: string;
  account_holder: string;
  account_number_last4: string;
  status: "pending" | "verified" | "rejected";
  rejection_reason: string | null;
  verified_at: string | null;
}

export interface OrgDocumentSummary {
  id: string;
  doc_type: string;
  original_filename: string | null;
  created_at: string;
}

/**
 * The one place an organizer can change anything about their organization.
 *
 * Grouped rather than split across three pages because the three things an
 * owner needs after approval — the public profile, where the money goes, and
 * what was verified — are one visit's worth of work, and two of them were
 * previously unreachable from anywhere in the app.
 *
 * Gated on `org.manage` (owner). The bank account additionally requires
 * `bank_account.manage`; the two are held by the same role today, but the check
 * is separate so a future role split doesn't silently widen who sees the payout
 * destination.
 */
export default async function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  if (!UUID_RE.test(orgId)) notFound();

  const claims = await getAuthClaims();
  if (!claims) redirect("/auth/login");

  const supabase = await createClient();
  const { data: canManage } = await supabase.rpc("has_org_permission", {
    p_user_id: claims.id,
    p_org_id: orgId,
    p_permission: "org.manage",
  });

  if (!canManage) notFound();

  const { data: canManageBank } = await supabase.rpc("has_org_permission", {
    p_user_id: claims.id,
    p_org_id: orgId,
    p_permission: "bank_account.manage",
  });

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select(
      `id, name, description, links, email, phone, past_tournament_refs,
       avatar_url, entity_type, registration_number`,
    )
    .eq("id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!org) notFound();

  const [{ data: bankRow }, { data: documents }] = await Promise.all([
    canManageBank
      ? supabaseAdmin
          .from("organization_bank_accounts")
          .select(
            "bank_name, bank_code, account_holder, account_number, status, rejection_reason, verified_at",
          )
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from("organization_documents")
      .select("id, doc_type, original_filename, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true }),
  ]);

  // Masked before it crosses into the client bundle, the same rule the API
  // follows: the full account number never leaves the database.
  const bankAccount: MaskedBankAccount | null = bankRow
    ? {
        bank_name: bankRow.bank_name,
        bank_code: bankRow.bank_code,
        account_holder: bankRow.account_holder,
        account_number_last4: (bankRow.account_number as string).slice(-4),
        status: bankRow.status,
        rejection_reason: bankRow.rejection_reason,
        verified_at: bankRow.verified_at,
      }
    : null;

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <OrgSettingsClient
        organization={org as unknown as OrgProfile}
        bankAccount={bankAccount}
        canManageBank={canManageBank === true}
        documents={(documents ?? []) as OrgDocumentSummary[]}
      />
    </div>
  );
}
