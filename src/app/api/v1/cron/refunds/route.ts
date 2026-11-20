import { NextRequest, NextResponse } from "next/server";
import {
  INTERNAL_ERROR_MESSAGE,
  logInternalError,
} from "@/lib/http/internal-error";
import { sweepUnfiredRefunds } from "@/services/refunds/sweep";
import { withAuditContext } from "@/services/supabase/audit-context";

// Session-less background job (mirrors the CHIP webhook and the other crons):
// uses supabaseAdmin only, and needs the Node runtime for the refund emails'
// templates read from disk.
export const runtime = "nodejs";
// The sweep keeps itself well inside this (REFUND_SWEEP_BUDGET_MS) and leaves
// the rest for the next call, so this is only a ceiling.
export const maxDuration = 60;

/**
 * Sends cancellation refunds to CHIP, off the admin's approval request (#496).
 * Triggered every few minutes by a GitHub Actions schedule (see
 * .github/workflows/cancellation-refunds.yml) that POSTs here with the shared
 * CRON_SECRET and calls again while the response says `more`.
 *
 * Each call fires a time-boxed chunk (src/services/refunds/sweep.ts). Per-refund
 * failures are counted and skipped, never failing the call; they stay pending
 * and reach the admin Stuck refunds page. Failing to load the work list is a
 * 500, so the scheduled job shows as failed.
 */
async function handlePost(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error: {
          code: "MISCONFIGURED",
          message: "CRON_SECRET is not configured",
        },
      },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid or missing cron secret" } },
      { status: 401 },
    );
  }

  try {
    const stats = await sweepUnfiredRefunds();
    if (stats.fired > 0) console.info(`Refund sweep: ${JSON.stringify(stats)}`);
    return NextResponse.json({ data: stats }, { status: 200 });
  } catch (err) {
    logInternalError("Refund sweep: the run failed", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE } },
      { status: 500 },
    );
  }
}

export const POST = withAuditContext("cron.refunds", handlePost);
