import { supabaseAdmin } from "@/services/supabase/admin";
import { hasOrgPermission } from "@/services/supabase/permission";
import { authorizeOrgPermission } from "@/app/api/v1/organizations/_lib/authorize-org";
import { describePayoutFailure } from "@/services/payouts/failure-reason";
import {
  describeEarlyPayoutProblem,
  describeRecipientProblem,
} from "@/services/payouts/recipient-problem";
import { formatRinggit, parseSentinel } from "@/services/payouts/format";
import { MIN_PAYOUT_CENTS } from "@/services/payouts/constants";
import { notifyAdminsOfPayout } from "@/services/payouts/notify";
import { validateEarlyPayoutRequest } from "./validators";
import { NextRequest, NextResponse } from "next/server";

// Filing a request emails the platform admins, and templates are read from disk.
export const runtime = "nodejs";

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
  early_payout_cap_cents: number;
  early_payout_problem: string | null;
}

interface PayoutHistoryRow {
  id: string;
  tournament_id: string;
  kind: string;
  amount_cents: number;
  settled_amount_cents: number | null;
  status: string;
  approval: string;
  reason: string | null;
  rejection_reason: string | null;
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
 *
 * `early_payout` says how much could be requested early and, if nothing can, why.
 * `can_request_early_payout` is whether this viewer holds payout.request (owners).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.view");
  if (!auth.ok) return auth.response;

  const [overview, history, canRequest] = await Promise.all([
    supabaseAdmin.rpc("list_organization_payout_overview", { p_org_id: orgId }),
    supabaseAdmin
      .from("payouts")
      .select(
        "id, tournament_id, kind, amount_cents, settled_amount_cents, status, approval, reason, rejection_reason, failure_reason, chip_receipt_url, requested_at, processed_at, organization_id, recipient_organization_id",
      )
      .or(`organization_id.eq.${orgId},recipient_organization_id.eq.${orgId}`)
      .order("requested_at", { ascending: false }),
    hasOrgPermission(auth.userId, orgId, "payout.request"),
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
    // Only the organizing org can ask; a beneficiary is paid in full at the end.
    early_payout: row.is_beneficiary
      ? null
      : {
          cap_cents: row.early_payout_cap_cents,
          blocked: row.early_payout_problem
            ? describeEarlyPayoutProblem(row.early_payout_problem)
            : null,
        },
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
    reason: p.kind === "early" ? p.reason : null,
    rejection_reason: p.approval === "rejected" ? p.rejection_reason : null,
    // In words: the stored value can hold CHIP's raw response.
    failure_reason:
      p.status === "failed" ? describePayoutFailure(p.failure_reason) : null,
    receipt_url: p.chip_receipt_url,
    requested_at: p.requested_at,
    processed_at: p.processed_at,
    is_beneficiary: p.organization_id !== orgId,
  }));

  return NextResponse.json(
    { data: { tournaments, payouts, can_request_early_payout: canRequest } },
    { status: 200 },
  );
}

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

// request_early_payout's refusals, as responses an organizer can act on.
function requestErrorResponse(error: {
  code?: string;
  message: string;
}): NextResponse | null {
  if (error.code === "P0002") {
    return errorResponse("NOT_FOUND", "Tournament not found", 404);
  }
  if (error.code === "42501") {
    return errorResponse(
      "FORBIDDEN",
      "Only an organization owner can request an early payout",
      403,
    );
  }
  // The indexes behind the function's own checks: two requests racing past them.
  if (error.code === "23505") {
    if (error.message.includes("uniq_live_early_payout_per_tournament")) {
      return errorResponse(
        "PAYOUT_IN_FLIGHT",
        describeEarlyPayoutProblem("early_payout_in_flight"),
        409,
      );
    }
    if (error.message.includes("uniq_early_payout_seq_per_tournament")) {
      return errorResponse(
        "PAYOUT_LIMIT_REACHED",
        describeEarlyPayoutProblem("early_payout_limit_reached"),
        409,
      );
    }
    return null;
  }
  if (error.code !== "P0001") return null;

  const parsed = parseSentinel(error.message);
  if (!parsed) return null;
  const { sentinel, detail } = parsed;

  switch (sentinel) {
    case "EARLY_PAYOUT_NOT_ALLOWED": {
      const code = detail.trim();
      if (code === "early_payout_limit_reached") {
        return errorResponse("PAYOUT_LIMIT_REACHED", describeEarlyPayoutProblem(code), 409);
      }
      if (code === "early_payout_in_flight") {
        return errorResponse("PAYOUT_IN_FLIGHT", describeEarlyPayoutProblem(code), 409);
      }
      return errorResponse("EARLY_PAYOUT_NOT_ALLOWED", describeEarlyPayoutProblem(code), 409);
    }
    case "EARLY_PAYOUT_EXCEEDS_CAP": {
      const match = detail.match(/^(\d+) cents requested, (\d+) cents can be paid early$/);
      return errorResponse(
        "PAYOUT_EXCEEDS_CAP",
        match
          ? `${formatRinggit(Number(match[1]))} is more than the ${formatRinggit(Number(match[2]))} that can be paid out early.`
          : "That is more than can be paid out early.",
        400,
      );
    }
    case "PAYOUT_BELOW_MINIMUM":
      return errorResponse(
        "PAYOUT_BELOW_MINIMUM",
        `The minimum payout is ${formatRinggit(MIN_PAYOUT_CENTS)}.`,
        400,
      );
    case "EARLY_PAYOUT_INVALID":
      return errorResponse("VALIDATION_ERROR", detail, 400);
    default:
      return null;
  }
}

/**
 * Requests an early payout: up to half a tournament's net revenue once its
 * registration has closed, at most twice, for a platform admin to approve. Owner
 * only (payout.request), as it moves money to a bank account.
 *
 * The request reserves its amount straight away. Nothing is sent until it is
 * approved; see PATCH /api/v1/admin/payouts/[id].
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.request");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid request body", 400);
  }

  const validated = validateEarlyPayoutRequest(body);
  if ("error" in validated) return validated.error;
  const { tournament_id, amount_cents, reason } = validated.data;

  // The function checks payout.request against the tournament's own organization,
  // which may not be the one in this URL.
  const { data: tournament, error: lookupError } = await supabaseAdmin
    .from("tournaments")
    .select("id")
    .eq("id", tournament_id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (lookupError) {
    console.error(
      `Early payout: failed to look up tournament ${tournament_id}`,
      lookupError.message,
    );
    return errorResponse("INTERNAL_ERROR", lookupError.message, 500);
  }
  if (!tournament) {
    return errorResponse("NOT_FOUND", "Tournament not found", 404);
  }

  const { data: payoutId, error } = await supabaseAdmin.rpc("request_early_payout", {
    p_tournament_id: tournament_id,
    p_user_id: auth.userId,
    p_amount_cents: amount_cents,
    p_reason: reason,
  });

  if (error) {
    const mapped = requestErrorResponse(error);
    if (mapped) {
      console.warn(
        `Early payout: request_early_payout refused tournament ${tournament_id}`,
        error.message,
      );
      return mapped;
    }
    console.error(
      `Early payout: request_early_payout failed for tournament ${tournament_id}`,
      error.code ? `${error.code}: ${error.message}` : error.message,
    );
    return errorResponse("INTERNAL_ERROR", error.message, 500);
  }

  console.info(
    `Early payout: user ${auth.userId} requested ${amount_cents} cents for tournament ${tournament_id} (payout ${payoutId})`,
  );

  // The admin queue would otherwise be the only way anyone finds out.
  await notifyAdminsOfPayout(payoutId as string, "early_request");

  return NextResponse.json({ data: { payout_id: payoutId } }, { status: 201 });
}
