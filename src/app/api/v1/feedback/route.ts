import { NextRequest, NextResponse } from "next/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import { recordBugReportAttempt } from "@/services/redis/redis";
import { getClientIp } from "@/lib/http/request-ip";
import {
  internalErrorResponse,
  logInternalError,
} from "@/lib/http/internal-error";
import {
  DESCRIPTION_MAX_LENGTH,
  DETAILS_MAX_LENGTH,
  cleanText,
  issueBody,
  issueTitle,
  reportReference,
  stripPathSecrets,
  toPathname,
  type IssueContext,
} from "@/services/bug-reports/format";
import { createBugReportIssue } from "@/services/bug-reports/github";

/**
 * POST /api/v1/feedback — the in-app bug report (#616).
 *
 * Each report becomes an issue on the PUBLIC GitHub repo, labelled `bug` and
 * `user-reported`. The issue never says who sent it; the reporter is kept in
 * the private bug_reports row, which is saved first so a failed filing loses
 * nothing. Signed-out visitors can report too (a signup bug is exactly what
 * they'd hit), under a tighter rate limit.
 *
 * Body: { description, details?, path?, viewport?: { width, height },
 *         sentryEventId?, website? }
 * `website` is a honeypot: a field hidden from people that bots fill in.
 *
 * 201 { reference }   filed
 * 400                 invalid input
 * 429                 rate limited (Retry-After)
 * 502 { reference }   saved, but GitHub refused; support files it by hand
 */

const PATH_MAX_LENGTH = 2000;
const USER_AGENT_MAX_LENGTH = 300;
const FILING_ERROR_MAX_LENGTH = 500;
const SENTRY_EVENT_ID = /^[0-9a-f]{32}$/;

type ParsedReport = {
  description: string;
  details: string | null;
  path: string | null;
  viewport: string | null;
  sentryEventId: string | null;
  honeypot: boolean;
};

function validationError(message: string) {
  return NextResponse.json(
    { error: { code: "VALIDATION_ERROR", message } },
    { status: 400 },
  );
}

function parseReport(body: unknown): ParsedReport | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "Invalid request body";
  }
  const input = body as Record<string, unknown>;

  if (typeof input.description !== "string") {
    return "Tell us what happened";
  }
  const description = cleanText(input.description);
  if (!description) return "Tell us what happened";
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return `Keep the description under ${DESCRIPTION_MAX_LENGTH} characters`;
  }

  if (input.details !== undefined && typeof input.details !== "string") {
    return "Invalid steps to reproduce";
  }
  const details = input.details ? cleanText(input.details) : "";
  if (details.length > DETAILS_MAX_LENGTH) {
    return `Keep the steps under ${DETAILS_MAX_LENGTH} characters`;
  }

  // Context is best-effort: anything malformed is dropped, not refused, so a
  // report is never lost over a detail the reporter didn't type.
  const rawPath =
    typeof input.path === "string" && input.path.length <= PATH_MAX_LENGTH
      ? toPathname(input.path)
      : null;

  let viewport: string | null = null;
  const vp = input.viewport as { width?: unknown; height?: unknown } | null;
  if (
    vp &&
    typeof vp === "object" &&
    Number.isInteger(vp.width) &&
    Number.isInteger(vp.height) &&
    (vp.width as number) > 0 &&
    (vp.height as number) > 0 &&
    (vp.width as number) <= 20000 &&
    (vp.height as number) <= 20000
  ) {
    viewport = `${vp.width}x${vp.height}`;
  }

  const sentryEventId =
    typeof input.sentryEventId === "string" &&
    SENTRY_EVENT_ID.test(input.sentryEventId)
      ? input.sentryEventId
      : null;

  return {
    description,
    details: details || null,
    path: rawPath ? stripPathSecrets(rawPath) : null,
    viewport,
    sentryEventId,
    honeypot: typeof input.website === "string" && input.website !== "",
  };
}

function appVersion(): string {
  const version = process.env.APP_VERSION || "unknown";
  const commit = process.env.APP_COMMIT;
  return commit ? `${version} (${commit})` : version;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationError("Invalid JSON body");
  }

  const parsed = parseReport(body);
  if (typeof parsed === "string") return validationError(parsed);

  const claims = await getAuthClaims();
  const userId = claims?.id ?? null;

  let retryAfter: number;
  try {
    retryAfter = await recordBugReportAttempt(getClientIp(request), userId);
  } catch (err) {
    // Fail closed: every report is a public artifact on our repo, so an
    // unlimited endpoint is worse than a briefly unavailable form.
    return internalErrorResponse("Feedback: rate limit check failed", err);
  }
  if (retryAfter > 0) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message:
            "You've sent several reports in a short time. Please try again later.",
        },
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  // A bot that filled the hidden field is told it worked and nothing is kept.
  // Checked after the rate limit so it costs the bot its budget too.
  if (parsed.honeypot) {
    return NextResponse.json(
      { reference: reportReference(crypto.randomUUID()) },
      { status: 201 },
    );
  }

  const userAgent =
    request.headers.get("user-agent")?.slice(0, USER_AGENT_MAX_LENGTH) ?? null;
  const environment =
    process.env.NEXT_PUBLIC_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
  const version = appVersion();

  // Saved before GitHub is called, so the report survives a failed filing.
  const { data: saved, error: saveError } = await supabaseAdmin
    .from("bug_reports")
    .insert({
      user_id: userId,
      description: parsed.description,
      details: parsed.details,
      context: {
        path: parsed.path,
        user_agent: userAgent,
        viewport: parsed.viewport,
        app_version: version,
        environment,
        sentry_event_id: parsed.sentryEventId,
      },
    })
    .select("id, created_at")
    .single();

  if (saveError || !saved) {
    return internalErrorResponse(
      "Feedback: saving the bug report failed",
      saveError,
    );
  }

  const reference = reportReference(saved.id as string);
  const context: IssueContext = {
    reference,
    path: parsed.path,
    userAgent,
    viewport: parsed.viewport,
    appVersion: version,
    environment,
    reportedAt: new Date(saved.created_at as string).toISOString(),
    signedIn: userId !== null,
    sentryEventId: parsed.sentryEventId,
  };

  let issueNumber: number;
  try {
    issueNumber = await createBugReportIssue(
      issueTitle(parsed.description),
      issueBody(parsed.description, parsed.details, context),
    );
  } catch (err) {
    logInternalError(
      `Feedback: filing bug report ${reference} on GitHub failed`,
      err,
    );
    const message = err instanceof Error ? err.message : String(err);
    const { error: markError } = await supabaseAdmin
      .from("bug_reports")
      .update({ filing_error: message.slice(0, FILING_ERROR_MAX_LENGTH) })
      .eq("id", saved.id);
    if (markError) {
      logInternalError(
        `Feedback: recording the filing failure for ${reference} failed`,
        markError,
      );
    }
    return NextResponse.json(
      {
        reference,
        error: {
          code: "FILING_FAILED",
          message:
            "We saved your report but couldn't pass it to the team just now. We'll pick it up from here.",
        },
      },
      { status: 502 },
    );
  }

  const { error: linkError } = await supabaseAdmin
    .from("bug_reports")
    .update({
      github_issue_number: issueNumber,
      filed_at: new Date().toISOString(),
      filing_error: null,
    })
    .eq("id", saved.id);
  if (linkError) {
    // The issue exists, so the reporter is told it worked. Support can still
    // match the row to the issue by the reference quoted in it.
    logInternalError(
      `Feedback: linking ${reference} to issue #${issueNumber} failed`,
      linkError,
    );
  }

  return NextResponse.json({ reference }, { status: 201 });
}
