import { NextResponse } from "next/server";

/**
 * What a caller sees when a request fails for a reason they can't fix.
 *
 * Database and auth-server errors describe the schema ("insert or update on
 * table "organizations" violates foreign key constraint ...") and must never
 * reach the browser: they mean nothing to the user and leak table, column and
 * constraint names to anyone probing the API.
 */
export const INTERNAL_ERROR_MESSAGE =
  "Something went wrong on our end. Please try again later.";

/**
 * Log an unexpected failure server-side and return a generic 500.
 *
 * The details go to `console.error`, which Sentry captures as an event
 * (src/services/sentry/server.ts), so nothing is lost by keeping them out of
 * the response. `context` should name the route and operation so the event is
 * findable, e.g. "Org applications: create_organization_application failed".
 */
export function internalErrorResponse(
  context: string,
  cause?: unknown,
): NextResponse {
  if (cause === undefined) {
    console.error(context);
  } else {
    console.error(context, describeCause(cause));
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE } },
    { status: 500 },
  );
}

// Supabase errors are plain objects ({ code, message, details, hint }), which
// console.error would print as "[object Object]" once Sentry stringifies them.
// Flatten them to one readable line; pass Errors and strings through.
function describeCause(cause: unknown): unknown {
  if (cause instanceof Error || typeof cause !== "object" || cause === null) {
    return cause;
  }
  const { code, message, details, hint } = cause as Record<string, unknown>;
  if (typeof message !== "string") return cause;
  return [
    code ? `${String(code)}: ${message}` : message,
    details ? `details: ${String(details)}` : null,
    hint ? `hint: ${String(hint)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}
