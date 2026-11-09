// The numbers that govern organizer payouts. MIN_PAYOUT_CENTS and
// EARLY_PAYOUT_MAX_PCT are mirrored as constants inside the SQL functions
// (007_payment_functions.sql), so the database enforces them even if a route is
// bypassed. Change them in both places.

/** Days after the tournament's final scheduled session before it is paid out. */
export const PAYOUT_HOLD_DAYS = 3;

/** RM10. Below this, CHIP's fees exceed the transfer. */
export const MIN_PAYOUT_CENTS = 1000;

/**
 * RM1. What CHIP Send takes from the Send balance for each successful transfer, on
 * top of the amount sent. A budget request has to cover it, or the payout it was
 * raised for still can't go out once the allocation is approved.
 */
export const CHIP_SEND_FEE_CENTS = 100;

/** The most of a tournament's net revenue that can be paid out early. */
export const EARLY_PAYOUT_MAX_PCT = 50;

/** CHIP Send calls in flight at once during a sweep. Cf. REFUND_CONCURRENCY = 5. */
export const PAYOUT_CONCURRENCY = 3;

/** A payout `processing` for this long is reconciled via GET, not left to the webhook. */
export const PAYOUT_STUCK_HOURS = 24;
