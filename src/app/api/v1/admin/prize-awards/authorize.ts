import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

/**
 * The gate for the admin prize award routes (#523): a session holding the
 * global platform.manage permission, as for admin payouts.
 */
export async function authorizePlatformAdmin(
  context: string,
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const claims = await getAuthClaims();
  if (!claims) {
    return { ok: false, response: errorResponse("UNAUTHORIZED", "Authentication required", 401) };
  }
  const supabase = await createClient();
  const { data: isAdmin, error } = await supabase.rpc("has_global_permission", {
    p_user_id: claims.id,
    p_permission: "platform.manage",
  });
  if (error) {
    return { ok: false, response: internalErrorResponse(`${context}: permission check failed`, error) };
  }
  if (!isAdmin) {
    return { ok: false, response: errorResponse("FORBIDDEN", "Admin access required", 403) };
  }
  return { ok: true, userId: claims.id };
}
