// payouts.failure_reason holds a code for the failures we decide ourselves, and a
// raw CHIP status plus message for the ones CHIP decides. Neither is fit to show an
// organizer, so everything they read goes through here.

const REASONS: Record<string, string> = {
  insufficient_available_balance:
    "There was not enough left to pay out for this tournament, usually because players were refunded after the payout was requested.",
  bank_account_not_verified:
    "The payout bank account is no longer verified, or was changed after this payout was requested.",
  tournament_cancelled: "This tournament was cancelled.",
  send_instruction_rejected: "The transfer was rejected during processing.",
  send_instruction_deleted: "The transfer was withdrawn before it completed.",
  send_instruction_failed: "The transfer could not be completed.",
};

const FALLBACK = "The transfer could not be completed.";

export function describePayoutFailure(reason: string | null | undefined): string {
  if (!reason) return FALLBACK;
  // A raw `chip_send_400: {...}` from CHIP is for us, not for them.
  return REASONS[reason] ?? FALLBACK;
}
