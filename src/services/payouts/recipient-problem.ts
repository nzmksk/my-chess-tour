// The codes payout_recipient_problem and tournament_payout_block_reason return
// (003/007 migrations), in words. Pure, so both routes and client components can
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
