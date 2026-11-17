import { NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

/**
 * Turns an error from create_ / accept_ / decline_ / revoke_organization_invitation
 * (003) into the response to send. Each refusal is raised with an INVITATION_*
 * sentinel prefix and a stable SQLSTATE.
 *
 * `action` names what was being attempted, for the log of an unexpected error.
 */
export function invitationErrorResponse(
  error: { code?: string; message: string },
  action: string,
): NextResponse {
  const respond = (code: string, message: string, status: number) =>
    NextResponse.json({ error: { code, message } }, { status });
  const is = (sentinel: string) => error.message.startsWith(sentinel);

  if (is("INVITATION_NOT_FOUND")) {
    return respond("NOT_FOUND", "Invitation not found", 404);
  }
  if (is("INVITATION_WRONG_ACCOUNT")) {
    return respond(
      "WRONG_ACCOUNT",
      "This invitation was sent to a different email address. Sign in with that address to accept it.",
      403,
    );
  }
  if (is("INVITATION_FORBIDDEN")) {
    return respond("FORBIDDEN", "Insufficient permissions", 403);
  }
  if (is("INVITATION_ALREADY_MEMBER")) {
    return respond(
      "CONFLICT",
      "User is already a member of this organization",
      409,
    );
  }
  if (is("INVITATION_INVALID_ROLE")) {
    return respond(
      "VALIDATION_ERROR",
      "Role must be 'admin' or 'member'",
      400,
    );
  }
  if (is("INVITATION_EXPIRED")) {
    return respond("INVITATION_EXPIRED", "This invitation has expired", 410);
  }
  if (is("INVITATION_CLOSED")) {
    return respond(
      "INVITATION_CLOSED",
      "This invitation is no longer open",
      409,
    );
  }
  if (is("INVITATION_ORG_UNAVAILABLE")) {
    return respond(
      "FORBIDDEN",
      "This organization isn't accepting members right now",
      403,
    );
  }
  return internalErrorResponse(
    `Organization invitation: unexpected error ${action}`,
    error,
  );
}
