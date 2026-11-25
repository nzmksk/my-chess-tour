import { NextRequest, NextResponse } from "next/server";
import {
  INTERNAL_ERROR_MESSAGE,
  logInternalError,
} from "@/lib/http/internal-error";
import { runGuardianshipAgeOuts } from "@/services/guardianship/age-out";
import { withAuditContext } from "@/services/supabase/audit-context";

export const runtime = "nodejs";
export const maxDuration = 60;

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
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or missing cron secret",
        },
      },
      { status: 401 },
    );
  }

  try {
    const stats = await runGuardianshipAgeOuts();
    if (stats.ended > 0 || stats.notices > 0) {
      console.info(`Guardianship age-outs: ${JSON.stringify(stats)}`);
    }
    return NextResponse.json({ data: stats }, { status: 200 });
  } catch (err) {
    logInternalError("Guardianship age-outs: the run failed", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE } },
      { status: 500 },
    );
  }
}

export const POST = withAuditContext("cron.guardianship-age-outs", handlePost);
