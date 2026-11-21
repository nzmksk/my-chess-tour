# 0009. Refund states and stuck refunds

- Status: Accepted
- Date: 2026-11-21
- Issue: #497, #675

## Context

Players and organizers both see where a refund is, on the server and in the
browser, so they need one definition of it. Refunds go through CHIP, whose
webhooks normally land within seconds but can fail or never arrive.

## Decision

`refundState` (`src/lib/refunds/state.ts`) is pure, so every view shares it:

- `refunded`: `settle_refund` booked it (`processed_at`); the money has left.
- `failed`: CHIP reported a failure (`failed_at`) and nothing has cleared
  since. The refund is still owed and stays pending for a retry.
- `processing`: queued or in flight with CHIP, nothing back yet.

`processed_at` wins over `failed_at`: a retry that clears after a failure is
refunded, and `failed_at` stays only as history. `liveRefund` picks the refund
a registration shows, skipping rejected ones; at most one live refund exists
per registration (`uniq_active_refund_per_registration`).

A fired refund with no answer after `REFUND_STUCK_AFTER_MINUTES` (15, in
`src/lib/refunds/stuck-after.ts`) counts as stuck and may be fired again. A
refund CHIP reports failed waits that long too, because a failure webhook
can't be tied to the fire it belongs to (`refund_fire_due` in
`006_payment_functions.sql`). The constant lives in `lib` so the admin page
can show it without importing the server-side fire path.
`REFUND_STUCK_AFTER_INTERVAL` is the same value as a Postgres interval, for
`claim_refund_fire` and `list_stuck_refunds`.

## Consequences

- The fifteen minutes is one constant shared by the UI and the database calls.

See also [refund-flow](../../wiki/refund-flow.md).
