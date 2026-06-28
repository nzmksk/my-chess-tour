import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { NextRequest, NextResponse } from "next/server";

type OrgStatusRow = { approval_status: string };
type TournamentStatusRow = { status: string };
type PayoutSummaryRow = { effective_platform_fee_cents: number };
type PendingOrgRow = { id: string; name: string; email: string | null; created_at: string };
type RecentTournamentRow = {
  id: string;
  slug: string | null;
  name: string;
  start_date: string;
  status: string;
  max_participants: number;
  organization_id: string | null;
};
type RegistrationRow = { tournament_id: string };
type OrgNameRow = { id: string; name: string };

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const supabase = await createClient();
  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: claims.id, p_permission: "platform.manage" },
  );

  if (permissionError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: permissionError.message } },
      { status: 500 },
    );
  }

  if (!isAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 },
    );
  }

  const [
    { count: userCount, error: userError },
    { data: orgStatusRows, error: orgError },
    { data: tournamentStatusRows, error: tourError },
    { count: totalRegistrations, error: regError },
    { data: payoutRows, error: payoutError },
    { data: pendingOrgs, error: pendingOrgsError },
    { data: recentTournamentRows, error: recentTourError },
  ] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null),
    supabaseAdmin
      .from("organizations")
      .select("approval_status")
      .is("deleted_at", null),
    supabaseAdmin.from("tournaments").select("status"),
    supabaseAdmin
      .from("registrations")
      .select("*", { count: "exact", head: true })
      .eq("status", "confirmed"),
    supabaseAdmin
      .from("tournament_payout_summary")
      .select("effective_platform_fee_cents"),
    supabaseAdmin
      .from("organizations")
      .select("id, name, email, created_at")
      .eq("approval_status", "pending")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(5),
    supabaseAdmin
      .from("tournaments")
      .select(
        "id, slug, name, start_date, status, max_participants, organization_id",
      )
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (userError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: userError.message } },
      { status: 500 },
    );
  }
  if (orgError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: orgError.message } },
      { status: 500 },
    );
  }
  if (tourError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: tourError.message } },
      { status: 500 },
    );
  }
  if (regError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: regError.message } },
      { status: 500 },
    );
  }
  if (payoutError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: payoutError.message } },
      { status: 500 },
    );
  }
  if (pendingOrgsError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: pendingOrgsError.message } },
      { status: 500 },
    );
  }
  if (recentTourError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: recentTourError.message } },
      { status: 500 },
    );
  }

  const allOrgStatuses = (orgStatusRows ?? []) as OrgStatusRow[];
  const pendingOrgCount = allOrgStatuses.filter(
    (o) => o.approval_status === "pending",
  ).length;
  const approvedOrgCount = allOrgStatuses.filter(
    (o) => o.approval_status === "approved",
  ).length;
  const rejectedOrgCount = allOrgStatuses.filter(
    (o) => o.approval_status === "rejected",
  ).length;

  const allTournamentStatuses = (tournamentStatusRows ?? []) as TournamentStatusRow[];
  const publishedCount = allTournamentStatuses.filter(
    (t) => t.status === "published",
  ).length;
  const draftCount = allTournamentStatuses.filter(
    (t) => t.status === "draft",
  ).length;
  const cancelledCount = allTournamentStatuses.filter(
    (t) => t.status === "cancelled",
  ).length;

  const platformRevenueCents = (payoutRows ?? []).reduce(
    (sum: number, row: PayoutSummaryRow) =>
      sum + (row.effective_platform_fee_cents ?? 0),
    0,
  );

  const recentTours = (recentTournamentRows ?? []) as RecentTournamentRow[];
  const recentIds = recentTours.map((t) => t.id);
  const orgIds = [
    ...new Set(recentTours.map((t) => t.organization_id).filter(Boolean)),
  ] as string[];

  const participantCounts: Record<string, number> = {};
  const orgNameMap: Record<string, string> = {};

  if (recentIds.length > 0) {
    const [{ data: recentRegs, error: recentRegsError }, { data: orgs, error: orgsError }] =
      await Promise.all([
        supabaseAdmin
          .from("registrations")
          .select("tournament_id")
          .in("tournament_id", recentIds)
          .eq("status", "confirmed"),
        orgIds.length > 0
          ? supabaseAdmin
              .from("organizations")
              .select("id, name")
              .in("id", orgIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (recentRegsError) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: recentRegsError.message } },
        { status: 500 },
      );
    }
    if (orgsError) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: orgsError.message } },
        { status: 500 },
      );
    }

    for (const reg of (recentRegs ?? []) as RegistrationRow[]) {
      participantCounts[reg.tournament_id] =
        (participantCounts[reg.tournament_id] ?? 0) + 1;
    }

    for (const org of (orgs ?? []) as OrgNameRow[]) {
      orgNameMap[org.id] = org.name;
    }
  }

  return NextResponse.json(
    {
      data: {
        stats: {
          total_users: userCount ?? 0,
          organizations: {
            total: allOrgStatuses.length,
            pending: pendingOrgCount,
            approved: approvedOrgCount,
            rejected: rejectedOrgCount,
          },
          tournaments: {
            total: allTournamentStatuses.length,
            published: publishedCount,
            draft: draftCount,
            cancelled: cancelledCount,
          },
          total_registrations: totalRegistrations ?? 0,
          platform_revenue_cents: platformRevenueCents,
        },
        pending_organizations: (pendingOrgs ?? []).map((o: PendingOrgRow) => ({
          id: o.id,
          name: o.name,
          email: o.email,
          created_at: o.created_at,
        })),
        recent_tournaments: recentTours.map((t) => ({
          id: t.id,
          slug: t.slug,
          name: t.name,
          organization_name: t.organization_id
            ? (orgNameMap[t.organization_id] ?? null)
            : null,
          start_date: t.start_date,
          status: t.status,
          current_participants: participantCounts[t.id] ?? 0,
          max_participants: t.max_participants,
        })),
      },
    },
    { status: 200 },
  );
}
