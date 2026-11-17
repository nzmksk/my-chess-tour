import { NextRequest, NextResponse } from "next/server";
import {
  INTERNAL_ERROR_MESSAGE,
  logInternalError,
} from "@/lib/http/internal-error";
import {
  type PassStats,
  type SweepStats,
  reconcileStuckPayouts,
  retryPendingPayouts,
  sweepPayableTournaments,
} from "@/services/payouts/sweep";
import {
  type BankRegistrationStats,
  registerUnregisteredBankAccounts,
} from "@/services/payouts/bank-account";

// Session-less background job (mirrors the CHIP webhook and the FIDE cron): uses
// supabaseAdmin only, and needs the Node runtime for CHIP Send's HMAC signing and
// the email templates read from disk.
export const runtime = "nodejs";
// Each payout is a handful of database calls and one or two CHIP Send requests,
// PAYOUT_CONCURRENCY at a time. Keep the window generous.
export const maxDuration = 300;

interface RunStats {
  bankAccounts: BankRegistrationStats | null;
  stuck: PassStats | null;
  retried: PassStats | null;
  sweep: SweepStats | null;
}

/**
 * Runs one pass. A pass that can't load its work list is logged and reported as
 * null, and the run carries on: the other passes don't depend on it.
 */
async function runPass<T>(
  name: string,
  pass: () => Promise<T>,
): Promise<T | null> {
  try {
    return await pass();
  } catch (err) {
    logInternalError(`Payout cron: the ${name} pass failed`, err);
    return null;
  }
}

/**
 * The daily organizer payout run. Triggered by a GitHub Actions schedule (see
 * .github/workflows/organizer-payouts.yml) that POSTs here with the shared
 * CRON_SECRET. Registers bank accounts a request left unregistered with CHIP
 * Send (src/services/payouts/bank-account.ts), reconciles stuck payouts, retries
 * pending ones, then pays every tournament whose automatic payout has fallen due
 * (src/services/payouts/sweep.ts).
 *
 * Per-payout failures are counted and skipped, never failing the whole run. A pass
 * that couldn't run at all makes this a 500, so the scheduled job shows as failed,
 * but the counts for the passes that did run are still returned.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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

  // In this order: an account CHIP verifies on the spot can be paid by this
  // run's sweep, and a payout the sweep parks on budget shouldn't be retried a
  // moment later by the pending pass.
  const stats: RunStats = {
    bankAccounts: await runPass("unregistered bank account", () =>
      registerUnregisteredBankAccounts(),
    ),
    stuck: await runPass("stuck payout", () => reconcileStuckPayouts()),
    retried: await runPass("pending payout", retryPendingPayouts),
    sweep: await runPass("payable tournament", sweepPayableTournaments),
  };

  console.info(`Payout cron: ${JSON.stringify(stats)}`);

  if (!stats.bankAccounts || !stats.stuck || !stats.retried || !stats.sweep) {
    return NextResponse.json(
      {
        error: { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE },
        data: stats,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: stats }, { status: 200 });
}
