// The numbers that govern organizer payouts. MIN_PAYOUT_CENTS and
// EARLY_PAYOUT_MAX_PCT are mirrored as constants inside the SQL functions
// (007_payment_functions.sql), so the database enforces them even if a route is
// bypassed. Change them in both places.

/** Days after the tournament's final scheduled session before it is paid out. */
export const PAYOUT_HOLD_DAYS = 3;

/** RM10. Below this, CHIP's fees exceed the transfer. */
export const MIN_PAYOUT_CENTS = 1000;

/** The most of a tournament's net revenue that can be paid out early. */
export const EARLY_PAYOUT_MAX_PCT = 50;

/** CHIP Send calls in flight at once during a sweep. Cf. REFUND_CONCURRENCY = 5. */
export const PAYOUT_CONCURRENCY = 3;

/** A payout `processing` for this long is reconciled via GET, not left to the webhook. */
export const PAYOUT_STUCK_HOURS = 24;
