import { NextResponse } from "next/server";

export const INTERNAL_ERROR_MESSAGE =
  "Something went wrong on our end. Please try again later.";

export function internalErrorResponse(
  context: string,
  cause?: unknown,
): NextResponse {
  logInternalError(context, cause);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE } },
    { status: 500 },
  );
}

export function logInternalError(context: string, cause?: unknown): void {
  if (cause === undefined) {
    console.error(context);
    return;
  }
  const detail = describeCause(cause);
  if (typeof detail === "string") {
    console.error(`${context} ${detail}`);
    return;
  }
  console.error(context.replaceAll("%", "%%"), detail);
}

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
