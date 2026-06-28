# Payment flow

How a player pays to register for a tournament, end to end. Payments go through
**CHIP** (gate.chip-in.asia). Money state is enforced authoritatively in Postgres
(SECURITY DEFINER functions + row locks) so concurrent webhooks, browser returns,
and resumes can't corrupt it. For webhook signing/events see
[chip-webhook.md](./chip-webhook.md).

## Data model

Two rows track one registration's money (`db/migrations/001_tables.sql`):

- **`registrations.status`** (`registration_status` enum): `pending_payment` →
  `confirmed` | `failed_payment` | `cancelled_payment`; plus `forfeited` (paid
  then forfeited). Key timestamps: `registered_at`, `confirmed_at`,
  `cancelled_at`, and `cancellation_reason` (text).
- **`payments.status`** (`payment_status` enum): `pending` → `paid` | `failed`.
  The registration's money row is `type='registration'`. `chip_transaction_id`
  is the CHIP purchase id; a partial UNIQUE index on it
  (`013_settle_amount_check.sql`) guarantees one purchase maps to one payment.

There is **no `expired` status** in either enum — expiry reuses
`cancelled_payment` (see [Expiry](#expiry-no-chip-event)).

## Pricing (commission math)

`compute_registration_amounts(amount, commission_rate, organizer_commission_pct)`
(`009_resume_payment.sql`) is the single source of truth for what a player pays.
It's used by both creation and resume so the two never drift:

```
platform_fee         = floor(amount * commission_rate / 100)
organizer_commission = floor(platform_fee * organizer_commission_pct / 10)
player_commission    = platform_fee - organizer_commission
gross  = amount + player_commission   -- what the player is charged
net    = gross - platform_fee         -- what the organizer nets
```

## Happy path

1. **Checkout** — `POST /api/v1/tournaments/[id]/checkout`
   (`src/app/api/v1/tournaments/[id]/checkout/route.ts`). Auth required.
   Validates tournament is `published`, registration deadline, fee-tier validity
   (incl. `valid_until`), and profile-based restrictions/eligibility.
2. **Create** — if the user has no existing registration, calls
   `create_registration_with_payment()` (`009`): atomically inserts a
   `registrations` row (`pending_payment`) and a `payments` row (`pending`) with
   the computed amounts. The `check_tournament_capacity` INSERT trigger
   (`010_reservation_ttl.sql`) enforces capacity inside Postgres.
3. **Initiate CHIP** — `initiateChipPayment()` calls
   `createChipPurchase()` (`src/services/chip/chip.ts`), passing `reference =
   payment.id`, success/failure redirects, and a `due` (purchase expiry, see
   below). Stores the returned purchase id as `chip_transaction_id` and returns
   the `checkout_url`. The browser is sent to CHIP.
4. **Settle (webhook)** — CHIP calls `POST /api/v1/webhooks/chip`
   (`src/app/api/v1/webhooks/chip/route.ts`). It verifies the RSA signature over
   the raw body, correlates the payment by `chip_transaction_id` (falling back to
   `reference`), maps the event to an outcome via `chipOutcome()`, and calls
   `settle_registration_payment()`.
5. **Confirm** — `settle_registration_payment(payment_id, paid, amount_cents)`
   (`013`) locks the payment row and, only while still `pending` (idempotent):
   - `paid=true` → payment `paid` (+`paid_at`), registration `confirmed`
     (+`confirmed_at`) — **but only if** `amount_cents` matches the recorded
     `gross_amount_cents` (guards a stale/re-priced purchase). A mismatch leaves
     it pending and returns `amount_mismatch` for ops to reconcile.
   - `paid=false` → payment `failed`, registration `failed_payment`.

## Outcome mapping

`chipOutcome(status?, eventType?)` (`chip.ts`) is shared by the webhook and the
return-page resolver so they can't drift:

- **paid**: status `paid`, or event `purchase.paid` / `purchase.captured`.
- **failed**: status `error` / `cancelled`, or event `purchase.payment_failure` /
  `purchase.cancelled`.
- **pending**: everything else (`created`, `hold`, `viewed`, `pending_*`, …).

## Browser return (reconciliation)

The CHIP redirect to `…/register/success` or `…/register/failure` can land
*before* the webhook. Both pages call `resolvePaymentState(tournamentId, userId)`
(`src/app/tournaments/[id]/register/_lib/resolvePaymentState.ts`), which:

- short-circuits `confirmed` / `failed_payment`;
- for `pending_payment`, fetches the live purchase via `getChipPurchase()` and
  settles through the **same** `settle_registration_payment` RPC the webhook uses
  (so the page is authoritative even if the webhook is late/missing);
- degrades to `pending` on any CHIP/network error (never claims a false result).

The resolved state drives `PaymentStatusView` (confirmed / pending / failed /
none).

## Resume & retry

If the user returns to checkout with an existing `pending_payment` or
`failed_payment` registration, `resumeRegistration()` (checkout route):

1. **Cancels the prior CHIP purchase** (`cancelChipPurchase`) before re-pricing,
   so only one checkout link is ever live (double-charge guard). Best-effort.
2. Calls `reset_registration_for_payment()` (`010`): re-checks capacity
   *excluding this row* (an UPDATE bypasses the INSERT trigger; a lapsed hold may
   have lost the seat), re-prices for the chosen tier, resets the payment to
   `pending`, nulls `chip_transaction_id`/`paid_at`, and refreshes
   `registered_at` (restarting the hold window).
3. Initiates a fresh CHIP purchase.

A concurrent double-submit that hits the `UNIQUE(user_id, tournament_id)`
constraint (`23505`) is recovered by re-reading the winner's row and resuming it.

## Capacity & the reservation hold

`assert_tournament_capacity()` (`010`) locks the tournament row `FOR UPDATE` and
counts `confirmed` seats **plus** `pending_payment` seats whose `registered_at`
is within the last **10 minutes**. So an abandoned checkout stops consuming
capacity after 10 minutes with no scheduler — the seat frees itself. Capacity is
enforced only in Postgres; there is no JS pre-check (it would double-count lapsed
holds).

## Expiry (no CHIP event)

The 10-minute hold frees *capacity* but never terminalizes the row, and CHIP
emits **no `purchase.expired` event** (see [chip-webhook.md](./chip-webhook.md)),
so expiry is **app-owned and time-based**:

- **CHIP `due`** — `createChipPurchase` sets `due = now + PAYMENT_DUE_MINUTES`
  (10 min), so the checkout link becomes unpayable when the hold lapses — closing
  the overbooking / double-charge window at the source.
- **Terminalization** — `expire_stale_pending_payments(p_ttl, p_tournament_id,
  p_registration_id, p_user_id)` (`014_expire_pending_payments.sql`) moves
  `pending_payment` rows older than the TTL to `cancelled_payment`
  (`cancellation_reason='payment_expired'`) and their payment to `failed`, using
  `FOR UPDATE SKIP LOCKED`. It returns affected `(registration_id,
  chip_transaction_id)` rows for best-effort CHIP cancel.
- **Threshold** — `PAYMENT_EXPIRY_MINUTES` (15 min) is deliberately *longer* than
  `due` (10 min) so any payment that could still have succeeded (only possible
  before `due`) has had its `purchase.paid` webhook delivered before we'd ever
  expire the row. Constants live in `src/services/chip/chip.ts`.
- **Trigger = lazy on read** (no cron). The sweep runs, scoped, before the read:
  - per-registration in `resolvePaymentState` (after the CHIP reconcile, so a
    late payment is caught first; also best-effort cancels the CHIP purchase);
  - per-tournament in `getTournamentManageData` (organizer roster);
  - per-user in `GET /api/v1/me/registrations` (My Tournaments list).
  Bulk sweeps skip the per-row CHIP cancel — `due` already makes links unpayable.

`expire_stale_pending_payments` called with no scoping args sweeps everything, so
it doubles as a future **pg_cron backstop** for rows never read again. None is
scheduled today — there is no scheduler in this project (Netlify, plain
`next build`/`start`).

## Files

- `src/services/chip/chip.ts` — CHIP client (`createChipPurchase` with `due`,
  `getChipPurchase`, `cancelChipPurchase`), `chipOutcome`, expiry constants.
- `src/app/api/v1/tournaments/[id]/checkout/route.ts` — create / resume / initiate.
- `src/app/api/v1/webhooks/chip/route.ts` — signature verify + settle.
- `src/app/tournaments/[id]/register/_lib/resolvePaymentState.ts` — return-page
  reconcile + lazy expiry.
- DB functions: `009_resume_payment.sql` (create/compute/reset),
  `010_reservation_ttl.sql` (capacity/hold/reset), `013_settle_amount_check.sql`
  (settle + amount guard), `014_expire_pending_payments.sql` (expiry).
