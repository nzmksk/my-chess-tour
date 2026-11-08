import { supabaseAdmin } from "@/services/supabase/admin";
import { authorizeOrgPermission } from "@/app/api/v1/organizations/_lib/authorize-org";
import { NextRequest, NextResponse } from "next/server";

/**
 * Payout nominations waiting on this organization. Gated on payout.request, the
 * permission needed to act on one, so the dashboard panel only appears for people
 * who can use it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.request");
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin.rpc("list_pending_payout_nominations", {
    p_org_id: orgId,
  });

  if (error) {
    console.error(`Organization ${orgId} nominations: failed to load`, error.message);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: data ?? [] }, { status: 200 });
}
