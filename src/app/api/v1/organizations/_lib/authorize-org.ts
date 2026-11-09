import { supabaseAdmin } from "@/services/supabase/admin";
import {
  getAuthClaims,
  hasOrgPermission,
} from "@/services/supabase/permission";
import { NextResponse } from "next/server";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuthorizeResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

const fail = (code: string, message: string, status: number): AuthorizeResult => ({
  ok: false,
  response: NextResponse.json({ error: { code, message } }, { status }),
});

/**
 * Gate for organization routes that turn on one permission key rather than a role
 * name: valid id, a session, an approved organization, then the key itself.
 */
export async function authorizeOrgPermission(
  orgId: string,
  permission: string,
): Promise<AuthorizeResult> {
  if (!UUID_RE.test(orgId)) {
    return fail("VALIDATION_ERROR", "Invalid organization ID", 400);
  }

  const claims = await getAuthClaims();
  if (!claims) {
    return fail("UNAUTHORIZED", "Authentication required", 401);
  }

  const { data: org, error } = await supabaseAdmin
    .from("organizations")
    .select("id, approval_status")
    .eq("id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return fail("INTERNAL_ERROR", error.message, 500);
  if (!org) return fail("NOT_FOUND", "Organization not found", 404);
  if ((org as { approval_status: string }).approval_status !== "approved") {
    return fail("FORBIDDEN", "Organization is not approved", 403);
  }

  if (!(await hasOrgPermission(claims.id, orgId, permission))) {
    return fail("FORBIDDEN", "Access denied", 403);
  }

  return { ok: true, userId: claims.id };
}
