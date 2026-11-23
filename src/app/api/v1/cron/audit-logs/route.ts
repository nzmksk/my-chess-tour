import { NextRequest, NextResponse } from "next/server";
import {
  INTERNAL_ERROR_MESSAGE,
  logInternalError,
} from "@/lib/http/internal-error";
import { pruneAuditLogs } from "@/services/audit/retention";
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
    const result = await pruneAuditLogs();
    console.info(
      `Audit-log prune (${result.mode}): ${result.eligible} past retention, ${result.deleted} deleted`,
    );
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    logInternalError("Audit-log prune: the run failed", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE } },
      { status: 500 },
    );
  }
}

export const POST = withAuditContext("cron.audit-logs", handlePost);
