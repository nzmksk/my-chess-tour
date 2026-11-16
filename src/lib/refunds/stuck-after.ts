/**
 * How long a fired refund may go without an answer before it counts as stuck
 * and may be fired again (#497). CHIP's refund webhooks normally land within
 * seconds; anything still unsettled after this long is worth a look. A refund
 * CHIP reports failed is due again straight away (see refund_fire_due in
 * 007_payment_functions.sql).
 *
 * Pure, so the admin page can say "after 15 minutes" without importing the
 * server-side fire path.
 */
export const REFUND_STUCK_AFTER_MINUTES = 15;
// As a Postgres interval literal for claim_refund_fire / list_stuck_refunds.
export const REFUND_STUCK_AFTER_INTERVAL = `${REFUND_STUCK_AFTER_MINUTES} minutes`;
