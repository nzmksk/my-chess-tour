import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { executePayout } from "@/services/payouts/execute";
import { canResend } from "@/services/payouts/resend";
import { NextResponse } from "next/server";

// executePayout can send email, whose templates are read from disk.
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

/**
 * Re-runs the send of an approved payout that didn't go out: one parked on
 * budget, blocked, or interrupted by a transient failure. Nothing retries these
 * rows on its own until the Phase 7 sweep lands, and an early payout can't be
 * approved a second time to try again.
 *
 * Safe to call any number of times. executePayout re-checks everything, CHIP
 * dedupes on the payout id, and a settled row is left alone.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return errorResponse("VALIDATION_ERROR", "Invalid payout ID", 400);
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
    console.error("Admin payout send: permission check failed", permissionError.message);
    return errorResponse("INTERNAL_ERROR", permissionError.message, 500);
  }
  if (!isAdmin) {
    return errorResponse("FORBIDDEN", "Admin access required", 403);
  }

  // Checked up front so the admin is told why nothing happened, rather than
  // getting executePayout's bare "skipped".
  const { data: payout, error } = await supabaseAdmin
    .from("payouts")
    .select("approval, status, processed_at, chip_send_instruction_id")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error(`Admin payout send: failed to load payout ${id}`, error.message);
    return errorResponse("INTERNAL_ERROR", error.message, 500);
  }
  if (!payout) {
    return errorResponse("NOT_FOUND", "Payout not found", 404);
  }
  if (!canResend(payout)) {
    return errorResponse(
      "NOT_RESENDABLE",
      payout.approval !== "approved"
        ? "Only an approved payout can be sent."
        : "This payout is already with CHIP or settled.",
      409,
    );
  }

  const outcome = await executePayout(id);
  console.info(`Admin payout send: admin ${claims.id} re-ran payout ${id}: ${outcome}`);

  return NextResponse.json({ data: { payout_id: id, outcome } }, { status: 200 });
}
