import { supabaseAdmin } from "@/services/supabase/admin";
import { authorizeOrgPermission } from "@/app/api/v1/organizations/_lib/authorize-org";
import { describePayoutFailure } from "@/services/payouts/failure-reason";
import { describeRecipientProblem } from "@/services/payouts/recipient-problem";
import { NextRequest, NextResponse } from "next/server";

interface OverviewRow {
  tournament_id: string;
  tournament_name: string;
  tournament_status: string;
  organizing_organization_id: string | null;
  organizing_organization: string | null;
  recipient_organization_id: string | null;
  recipient_organization: string | null;
  is_beneficiary: boolean;
  net_revenue_cents: number;
  paid_payouts_cents: number;
  available_cents: number;
  early_requests_used: number;
  recipient_problem: string | null;
}

interface PayoutHistoryRow {
  id: string;
  tournament_id: string;
  kind: string;
  amount_cents: number;
  settled_amount_cents: number | null;
  status: string;
  approval: string;
  failure_reason: string | null;
  chip_receipt_url: string | null;
  requested_at: string;
  processed_at: string | null;
  organization_id: string;
  recipient_organization_id: string;
}

/**
 * An organization's payout position: per-tournament figures plus history, covering
 * tournaments it organized and those it accepted as beneficiary.
 *
 * Gated on payout.view, which org admins hold. Bank details are deliberately absent:
 * where the money lands is bank_account.manage, owner only.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.view");
  if (!auth.ok) return auth.response;

  const [overview, history] = await Promise.all([
    supabaseAdmin.rpc("list_organization_payout_overview", { p_org_id: orgId }),
    supabaseAdmin
      .from("payouts")
      .select(
        "id, tournament_id, kind, amount_cents, settled_amount_cents, status, approval, failure_reason, chip_receipt_url, requested_at, processed_at, organization_id, recipient_organization_id",
      )
      .or(`organization_id.eq.${orgId},recipient_organization_id.eq.${orgId}`)
      .order("requested_at", { ascending: false }),
  ]);

  const error = overview.error ?? history.error;
  if (error) {
    console.error(`Organization ${orgId} payouts: failed to load`, error.message);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  const tournaments = ((overview.data ?? []) as OverviewRow[]).map((row) => ({
    tournament_id: row.tournament_id,
    name: row.tournament_name,
    status: row.tournament_status,
    organizer: row.organizing_organization,
    recipient: {
      organization_id: row.recipient_organization_id,
      name: row.recipient_organization,
      problem: row.recipient_problem
        ? describeRecipientProblem(row.recipient_problem)
        : null,
    },
    is_beneficiary: row.is_beneficiary,
    net_revenue_cents: row.net_revenue_cents,
    paid_payouts_cents: row.paid_payouts_cents,
    available_cents: row.available_cents,
    early_requests_used: row.early_requests_used,
  }));

  const names = new Map(tournaments.map((t) => [t.tournament_id, t.name]));

  const payouts = ((history.data ?? []) as PayoutHistoryRow[]).map((p) => ({
    id: p.id,
    tournament_id: p.tournament_id,
    tournament_name: names.get(p.tournament_id) ?? null,
    kind: p.kind,
    amount_cents: p.settled_amount_cents ?? p.amount_cents,
    status: p.status,
    approval: p.approval,
    // In words: the stored value can hold CHIP's raw response.
    failure_reason:
      p.status === "failed" ? describePayoutFailure(p.failure_reason) : null,
    receipt_url: p.chip_receipt_url,
    requested_at: p.requested_at,
    processed_at: p.processed_at,
    is_beneficiary: p.organization_id !== orgId,
  }));

  return NextResponse.json({ data: { tournaments, payouts } }, { status: 200 });
}
