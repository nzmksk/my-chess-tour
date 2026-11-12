// The codes payout_recipient_problem, tournament_payout_block_reason and
// early_payout_problem return (003/007 migrations), in words. Pure, so both routes and client components can
// use it. An unknown code still reads as a sentence rather than a raw identifier.

const RECIPIENT_PROBLEMS: Record<string, string> = {
  organization_not_approved: "The organization is not approved.",
  entity_type_missing: "The organization has no entity type on file.",
  agreement_not_current:
    "The organization has not accepted the current Organizer Agreement.",
  bank_account_not_verified:
    "The organization does not have a verified payout bank account.",
};

const BLOCK_REASONS: Record<string, string> = {
  tournament_not_found: "The tournament could not be found.",
  tournament_cancelled: "The tournament is cancelled.",
  cancellation_pending: "A cancellation request is under review.",
  refund_pending: "A player refund has not settled yet.",
};

export function describeRecipientProblem(code: string): string {
  return RECIPIENT_PROBLEMS[code] ?? "The organization cannot receive payouts right now.";
}

export function describeBlockReason(code: string): string {
  return BLOCK_REASONS[code] ?? "This tournament cannot be paid out right now.";
}

const EARLY_PAYOUT_PROBLEMS: Record<string, string> = {
  tournament_not_published: "Early payouts are only available for published tournaments.",
  registration_open: "Early payouts open once registration has closed.",
  beneficiary_set:
    "This tournament pays out to a nominated organization, so it can only be paid out in full after it ends.",
  early_payout_limit_reached: "Both early payouts for this tournament have been used.",
  early_payout_in_flight:
    "An early payout for this tournament is already waiting for review or being sent.",
  nothing_payable_early: "There is nothing left that can be paid out early yet.",
};

/**
 * Why an early payout can't be requested, from an early_payout_problem code. The
 * function folds in the block and recipient checks, so their codes are covered too.
 */
export function describeEarlyPayoutProblem(code: string): string {
  if (EARLY_PAYOUT_PROBLEMS[code]) return EARLY_PAYOUT_PROBLEMS[code];
  if (BLOCK_REASONS[code]) return BLOCK_REASONS[code];
  if (RECIPIENT_PROBLEMS[code]) return RECIPIENT_PROBLEMS[code];
  return "An early payout can't be requested for this tournament right now.";
}
