import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { REFUND_STUCK_AFTER_MINUTES } from "@/lib/refunds/stuck-after";
import { loadStuckRefunds } from "@/services/refunds/stuck";
import { NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

/**
 * Refunds stuck in `pending`, across every tournament: still owed, and not
 * fired in the last REFUND_STUCK_AFTER_MINUTES (or failed since). A refund
 * fired a moment ago and awaiting its webhook is left off.
 */
export async function GET(): Promise<NextResponse> {
  const claims = await getAuthClaims();
  if (!claims) {
    return errorResponse("UNAUTHORIZED", "Authentication required", 401);
  }

  const supabase = await createClient();
  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: claims.id, p_permission: "platform.manage" },
  );
  if (permissionError) {
    return internalErrorResponse(
      "Admin stuck refunds: permission check failed",
      permissionError,
    );
  }
  if (!isAdmin) {
    return errorResponse("FORBIDDEN", "Admin access required", 403);
  }

  const { data, error } = await loadStuckRefunds();
  if (error) {
    return internalErrorResponse("Admin stuck refunds: failed to load", error);
  }

  return NextResponse.json(
    { data: { refunds: data, stuck_after_minutes: REFUND_STUCK_AFTER_MINUTES } },
    { status: 200 },
  );
}
