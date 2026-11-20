import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { fireRefund } from "@/services/refunds/fire";
import { NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { withAuditContext } from "@/services/supabase/audit-context";

// fireRefund can send the refund outcome email, whose templates are read from disk.
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

/**
 * Fires a stuck refund again (#497). Nothing retries a pending refund on its
 * own, so this is the recovery path for a refund the approval fan-out never
 * reached, CHIP refused or failed, or whose webhook never arrived.
 *
 * Safe to press any number of times:
 *   * claim_refund_fire refuses a refund whose money already moved (processed_at
 *     or chip_refund_id), one fired too recently to be stuck, and a second admin
 *     pressing at the same moment;
 *   * the purchase is read from CHIP before refunding, so one CHIP already
 *     refunded is settled from its record rather than refunded again, and one
 *     still `pending_refund` is left alone.
 *
 * Every attempt answers 200 with what happened (`outcome`), including refusals:
 * the admin is told why nothing changed. Only a missing refund is a 404.
 */
async function handlePost(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return errorResponse("VALIDATION_ERROR", "Invalid refund ID", 400);
  }

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
      "Admin refund re-fire: permission check failed",
      permissionError,
    );
  }
  if (!isAdmin) {
    return errorResponse("FORBIDDEN", "Admin access required", 403);
  }

  const outcome = await fireRefund(id, { reconcile: true });
  console.info(`Admin refund re-fire: admin ${claims.id} re-fired refund ${id}: ${outcome}`);

  if (outcome === "not_found") {
    return errorResponse("NOT_FOUND", "Refund not found", 404);
  }

  return NextResponse.json({ data: { refund_id: id, outcome } }, { status: 200 });
}

export const POST = withAuditContext("admin.refund.refire", handlePost);
