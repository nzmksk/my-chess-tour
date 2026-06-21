import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TournamentRow = {
  id: string;
  name: string;
  start_date: string;
  max_participants: number;
  status: string;
};

type PayoutSummaryRow = {
  total_registration_cents: number;
  net_payout_cents: number;
};

type RegistrationRow = {
  tournament_id: string;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  if (!UUID_RE.test(orgId)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid organization ID",
        },
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const [
    { data: org, error: orgError },
    { count: memberCount, error: memberError },
  ] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("id, name, approval_status, created_by")
      .eq("id", orgId)
      .is("deleted_at", null)
      .single(),
    supabaseAdmin
      .from("organization_memberships")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("user_id", user.id),
  ]);

  if (orgError) {
    if (orgError.code === "PGRST116") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: orgError.message } },
      { status: 500 },
    );
  }

  if (memberError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: memberError.message } },
      { status: 500 },
    );
  }

  if (org.approval_status !== "approved") {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Organization is not approved",
        },
      },
      { status: 403 },
    );
  }

  const isCreator = org.created_by === user.id;
  if (!isCreator && !memberCount) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Access denied" } },
      { status: 403 },
    );
  }

  const [
    { data: tournaments, error: tourError },
    { data: payoutRows, error: payoutError },
  ] = await Promise.all([
    supabaseAdmin
      .from("tournaments")
      .select("id, name, start_date, max_participants, status")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("tournament_payout_summary")
      .select("total_registration_cents, net_payout_cents")
      .eq("organization_id", orgId),
  ]);

  if (tourError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: tourError.message } },
      { status: 500 },
    );
  }

  if (payoutError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: payoutError.message } },
      { status: 500 },
    );
  }

  const allTournaments = (tournaments ?? []) as TournamentRow[];
  const allIds = allTournaments.map((t) => t.id);
  const recentTournaments = allTournaments.slice(0, 5);
  const recentIds = recentTournaments.map((t) => t.id);

  const payout = (payoutRows ?? []) as PayoutSummaryRow[];
  const totalRevenueCents = payout.reduce(
    (sum, row) => sum + (row.total_registration_cents ?? 0),
    0,
  );
  const pendingPayoutCents = payout.reduce(
    (sum, row) => sum + (row.net_payout_cents ?? 0),
    0,
  );

  const activeTournaments = allTournaments.filter(
    (t) => t.status === "published",
  ).length;

  let totalRegistrations = 0;
  const participantCounts: Record<string, number> = {};

  if (allIds.length > 0) {
    const [
      { count: regCount, error: regCountError },
      { data: recentRegs, error: recentRegsError },
    ] = await Promise.all([
      supabaseAdmin
        .from("registrations")
        .select("*", { count: "exact", head: true })
        .in("tournament_id", allIds)
        .eq("status", "confirmed"),
      supabaseAdmin
        .from("registrations")
        .select("tournament_id")
        .in("tournament_id", recentIds)
        .eq("status", "confirmed"),
    ]);

    if (regCountError) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: regCountError.message } },
        { status: 500 },
      );
    }

    if (recentRegsError) {
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: recentRegsError.message,
          },
        },
        { status: 500 },
      );
    }

    totalRegistrations = regCount ?? 0;

    const regs = (recentRegs ?? []) as RegistrationRow[];
    for (const reg of regs) {
      participantCounts[reg.tournament_id] =
        (participantCounts[reg.tournament_id] ?? 0) + 1;
    }
  }

  return NextResponse.json(
    {
      data: {
        organization: {
          id: org.id,
          name: org.name,
          approval_status: org.approval_status,
        },
        stats: {
          active_tournaments: activeTournaments,
          total_registrations: totalRegistrations,
          total_revenue_cents: totalRevenueCents,
          pending_payout_cents: pendingPayoutCents,
        },
        recent_tournaments: recentTournaments.map((t) => ({
          id: t.id,
          name: t.name,
          start_date: t.start_date,
          current_participants: participantCounts[t.id] ?? 0,
          max_participants: t.max_participants,
          status: t.status,
        })),
      },
    },
    { status: 200 },
  );
}
