import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuthorizeOk = { ok: true; userId: string };
type AuthorizeErr = { ok: false; response: NextResponse };

/**
 * Shared gate for organizer tournament-management actions: validates the ids,
 * the session, that the org exists and is approved, and that the caller is an
 * owner/admin of it. Mirrors the inline checks in the sibling publish/PATCH
 * routes but returns a typed result so callers can proceed once authorized.
 *
 * `action` is only used to phrase the 403 message (e.g. "close registration").
 */
export async function authorizeTournamentManager(
  orgId: string,
  id: string,
  action: string,
): Promise<AuthorizeOk | AuthorizeErr> {
  const err = (
    code: string,
    message: string,
    status: number,
  ): AuthorizeErr => ({
    ok: false,
    response: NextResponse.json({ error: { code, message } }, { status }),
  });

  if (!UUID_RE.test(orgId)) {
    return err("VALIDATION_ERROR", "Invalid organization ID", 400);
  }
  if (!UUID_RE.test(id)) {
    return err("VALIDATION_ERROR", "Invalid tournament ID", 400);
  }

  const claims = await getAuthClaims();
  if (!claims) {
    return err("UNAUTHORIZED", "Authentication required", 401);
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id, approval_status")
    .eq("id", orgId)
    .is("deleted_at", null)
    .single();

  if (orgError) {
    if (orgError.code === "PGRST116") {
      return err("NOT_FOUND", "Organization not found", 404);
    }
    return err("INTERNAL_ERROR", orgError.message, 500);
  }

  if (org.approval_status !== "approved") {
    return err("FORBIDDEN", "Organization is not approved", 403);
  }

  const { data: membership, error: memberError } = await supabaseAdmin
    .from("organization_memberships")
    .select("roles!inner(name)")
    .eq("organization_id", orgId)
    .eq("user_id", claims.id)
    .single();

  if (memberError || !membership) {
    return err("FORBIDDEN", "Access denied", 403);
  }

  const roleName = (membership as unknown as { roles: { name: string } }).roles
    ?.name;
  if (roleName !== "owner" && roleName !== "admin") {
    return err("FORBIDDEN", `Admin or owner role required to ${action}`, 403);
  }

  return { ok: true, userId: claims.id };
}
