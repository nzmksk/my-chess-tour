import { describeRecipientProblem } from "@/services/payouts/recipient-problem";
import { NextResponse } from "next/server";

/**
 * Turns an error from nominate_payout_beneficiary / accept_payout_nomination /
 * decline_payout_nomination into
 * the response to send. The functions raise a sentinel prefix with a stable SQLSTATE;
 * guard_tournament_money_fields raises the "locked" one with no sentinel at all.
 *
 * `action` names what was being attempted, for the log of an unexpected error.
 */
export function nominationErrorResponse(
  error: { code?: string; message: string },
  action: string,
): NextResponse {
  const respond = (code: string, message: string, status: number) =>
    NextResponse.json({ error: { code, message } }, { status });

  if (error.code === "42501") {
    return respond(
      "FORBIDDEN",
      "Only an organization owner can do this",
      403,
    );
  }
  if (error.code === "P0002") {
    return respond("NOT_FOUND", "Nomination not found", 404);
  }
  if (error.code === "P0001") {
    if (error.message.includes("these fields are locked")) {
      return respond(
        "CONFLICT",
        "The payout recipient is locked once a player has paid",
        409,
      );
    }
    if (error.message.startsWith("NOMINEE_INELIGIBLE: ")) {
      return respond(
        "NOMINEE_INELIGIBLE",
        describeRecipientProblem(error.message.slice("NOMINEE_INELIGIBLE: ".length)),
        409,
      );
    }
    if (error.message.startsWith("NOMINATION_SELF")) {
      return respond("CONFLICT", "An organization cannot nominate itself", 409);
    }
    if (error.message.startsWith("NOMINATION_CLOSED")) {
      return respond("CONFLICT", "This tournament is cancelled", 409);
    }
    if (error.message.startsWith("NOMINATION_ACCEPTED")) {
      return respond(
        "CONFLICT",
        "This nomination has already been accepted. Ask the organizer to withdraw it.",
        409,
      );
    }
    return respond("CONFLICT", error.message, 409);
  }
  console.error(
    `Payout nomination: unexpected error ${action}`,
    error.code ? `${error.code}: ${error.message}` : error.message,
  );
  return respond("INTERNAL_ERROR", error.message, 500);
}
