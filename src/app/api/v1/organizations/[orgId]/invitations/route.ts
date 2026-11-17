import { supabaseAdmin } from "@/services/supabase/admin";
import { authorizeOrgPermission } from "@/app/api/v1/organizations/_lib/authorize-org";
import {
  daysUntil,
  invitationState,
  personName,
} from "@/services/organizations/invitations";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

interface PendingRow {
  id: string;
  email: string;
  status: "pending";
  created_at: string;
  expires_at: string;
  roles: { name: string } | null;
  inviter: { first_name: string | null; last_name: string | null } | null;
}

/**
 * The organization's pending invitations, newest first, for the members page.
 * Includes ones that have expired without an answer (expired: true), so the
 * inviter can resend or revoke them. Answered and revoked ones are history and
 * aren't listed.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  const auth = await authorizeOrgPermission(orgId, "org.invite");
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("organization_invitations")
    .select(
      `id, email, status, created_at, expires_at,
       roles(name),
       inviter:users!invited_by(first_name, last_name)`,
    )
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return internalErrorResponse(
      "GET /api/v1/organizations/[orgId]/invitations",
      error,
    );
  }

  const invitations = (data as unknown as PendingRow[]).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.roles?.name ?? "member",
    invited_at: row.created_at,
    expires_at: row.expires_at,
    days_left: daysUntil(row.expires_at),
    expired: invitationState(row.status, row.expires_at) === "expired",
    invited_by: personName(row.inviter),
  }));

  return NextResponse.json({ data: invitations }, { status: 200 });
}
