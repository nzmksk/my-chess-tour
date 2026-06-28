# Payment flow

How a player pays to register for a tournament, end to end. Payments go through **CHIP** (gate.chip-in.asia). Money state is enforced authoritatively in Postgres (SECURITY DEFINER functions + row locks) so concurrent webhooks, browser returns, and resumes can't corrupt it. For webhook signing/events see [chip-webhook.md](./chip-webhook.md).

## Data model

Two rows track one registration's money (`db/migrations/001_tables.sql`):

- **`registrations.status`** (`registration_status` enum): `pending_payment` → `confirmed` | `failed_payment` | `cancelled_payment`; plus `forfeited` (paid then forfeited). Key timestamps: `registered_at`, `confirmed_at`, `cancelled_at`, and `cancellation_reason` (text).
- **`payments.status`** (`payment_status` enum): `pending` → `paid` | `failed`. The registration's money row is `type='registration'`. `chip_transaction_id` is the CHIP purchase id; a partial UNIQUE index on it (`002_indexes.sql`) guarantees one purchase maps to one payment.

There is **no `expired` status** in either enum — expiry reuses `cancelled_payment` (see [Expiry](#expiry-no-chip-event)).

## Pricing (commission math)

`compute_registration_amounts(amount, commission_rate, organizer_commission_pct)` (`db/migrations/007_payment_functions.sql`) is the single source of truth for what a player pays. It's used by both creation and resume so the two never drift:

```
platform_fee         = floor(amount * commission_rate / 100)
organizer_commission = floor(platform_fee * organizer_commission_pct / 10)
player_commission    = platform_fee - organizer_commission
gross  = amount + player_commission   -- what the player is charged
net    = gross - platform_fee         -- what the organizer nets
```

## Happy path

1. **Checkout** — `POST /api/v1/tournaments/[id]/checkout` (`src/app/api/v1/tournaments/[id]/checkout/route.ts`). Auth required. Validates tournament is `published`, registration deadline, fee-tier validity (incl. `valid_until`), and profile-based restrictions/eligibility.
2. **Create** — if the user has no existing registration, calls `create_registration_with_payment()` (`007`): atomically inserts a `registrations` row (`pending_payment`) and a `payments` row (`pending`) with the computed amounts. The `check_tournament_capacity` INSERT trigger (`003_functions_triggers.sql`) enforces capacity inside Postgres.
3. **Initiate CHIP** — `initiateChipPayment()` calls `createChipPurchase()` (`src/services/chip/chip.ts`), passing `reference = payment.id`, success/failure redirects, and a `due` (purchase expiry, see below). Stores the returned purchase id as `chip_transaction_id` and returns the `checkout_url`. The browser is sent to CHIP.
4. **Settle (webhook)** — CHIP calls `POST /api/v1/webhooks/chip` (`src/app/api/v1/webhooks/chip/route.ts`). It verifies the RSA signature over the raw body, correlates the payment by `chip_transaction_id` (falling back to `reference`), maps the event to an outcome via `chipOutcome()`, and calls `settle_registration_payment()`.
5. **Confirm** — `settle_registration_payment(payment_id, paid, amount_cents)` (`007`) locks the payment row, then:
  - `paid=true` → settles **any non-`paid` row** (idempotent: a row already `paid` is a no-op): payment `paid` (+`paid_at`), registration `confirmed` (+`confirmed_at`), pointing `current_payment_id` at the paid attempt — **but only if** `amount_cents` matches the recorded `gross_amount_cents` (guards a stale/re-priced purchase). A mismatch leaves it as-is and returns `amount_mismatch` for ops to reconcile. Honoring `paid` over a `failed` row is the **"real money wins"** guarantee: a late `paid` rescues a row that was marked `failed` by supersession or by a decline the payer then retried on the same purchase. See [Outcome mapping](#outcome-mapping).
  - `paid=false` → only terminalizes a still-`pending` row (never overrides a `paid` one): payment `failed`, and registration `failed_payment` **only if** this is its current attempt.

## Outcome mapping

`chipOutcome(status?, eventType?)` (`chip.ts`) is shared by the webhook and the return-page resolver so they can't drift:

- **paid**: status `paid`, or event `purchase.paid` / `purchase.captured`.
- **failed**: status `error` / `cancelled`, or event `purchase.payment_failure` / `purchase.cancelled`.
- **pending**: everything else (`created`, `hold`, `viewed`, `pending_*`, …).

## Browser return (reconciliation)

The CHIP redirect to `…/register/success` or `…/register/failure` can land _before_ the webhook. Both pages call `resolvePaymentState(tournamentId, userId)` (`src/app/tournaments/[id]/register/_lib/resolvePaymentState.ts`), which:

- short-circuits `confirmed`;
- for `pending_payment` **and `failed_payment`**, fetches the live purchase via `getChipPurchase()` and settles through the **same** `settle_registration_payment` RPC the webhook uses (so the page is authoritative even if the webhook is late/missing). A `failed_payment` is reconciled too because a payer can retry on the same CHIP purchase after a decline — a later `paid` then surfaces as `confirmed` rather than a stale `failed`; otherwise it stays `failed` (no expiry, no `pending` fallback);
- degrades to `pending` on any CHIP/network error (never claims a false result).

The resolved state drives `PaymentStatusView` (confirmed / pending / failed / none).

## Resume & retry

When the user returns to checkout with an existing registration, the route branches on whether the pending payment is still **live** (within the hold):

- **Live pending** (`pending_payment` and `registered_at` within `PAYMENT_TIMEOUT_MINUTES`) → `continuePendingPayment()`: hands back the **same** saved `payments.checkout_url` — **no** timer reset, **no** new purchase, **no** CHIP cancel. The fee tier is **locked**: requesting a different tier returns `409 PAYMENT_IN_PROGRESS` with the `unlock_at` time. This prevents seat-hold hoarding (the hold can no longer be extended by resuming) and silent tier swaps. The register page (`page.tsx`) detects this state and renders `PaymentInProgress.tsx` (a "Continue payment" card with the saved link, locked tier, and a countdown that refreshes the page when the hold lapses) instead of the tier form.
  - If the live pending attempt has **no stored link** (an earlier purchase-create failed), it isn't really in progress — `continuePendingPayment` falls through to a fresh start for whatever tier was requested instead of locking it.
- **Lapsed pending / `failed_payment` / `cancelled_payment`** → `resumeRegistration()` (a fresh start, any tier):

1. **Cancels the prior CHIP purchase** (`cancelChipPurchase`) — best-effort double-charge guard.
2. `start_new_payment_attempt()` (`007`): re-checks capacity _excluding this row_, **supersedes** the prior attempt (marks its still-`pending` payment `failed`), **appends a fresh `pending` payment row** for the chosen tier (the ledger is append-only — old rows are never reset/re-priced), points `current_payment_id` at it, and refreshes `registered_at` (a new hold window). Accepts `pending_payment`, `failed_payment`, **and `cancelled_payment`** (so an expired checkout can be re-registered).
3. Initiates a fresh CHIP purchase.

The checkout link is saved to `payments.checkout_url` in `initiateChipPayment` (alongside `chip_transaction_id`) so the live-resume path can reuse it.

A concurrent double-submit that hits the `UNIQUE(user_id, tournament_id)` constraint (`23505`) is recovered by re-reading the winner's row and resuming it.

## Capacity & the reservation hold

`assert_tournament_capacity()` (`003`) locks the tournament row `FOR UPDATE` and counts `confirmed` seats **plus** `pending_payment` seats whose `registered_at` is within the last **10 minutes**. So an abandoned checkout stops consuming capacity after 10 minutes with no scheduler — the seat frees itself. Capacity is enforced only in Postgres; there is no JS pre-check (it would double-count lapsed holds).

## Expiry (no CHIP event)

The 10-minute hold frees _capacity_ but never terminalizes the row, and CHIP emits **no `purchase.expired` event** (see [chip-webhook.md](./chip-webhook.md)), so expiry is **app-owned and time-based**:

- **CHIP `due`** — `createChipPurchase` sets `due = now + PAYMENT_TIMEOUT_MINUTES` (10 min), so the checkout link becomes unpayable when the hold lapses — closing the overbooking / double-charge window at the source.
- **Terminalization** — `expire_stale_pending_payments(p_ttl, p_tournament_id, p_registration_id, p_user_id)` (`007`) moves `pending_payment` registrations older than the TTL to `cancelled_payment` (`cancellation_reason='payment_expired'`), using `FOR UPDATE SKIP LOCKED`. It **leaves the payment row `pending`** so a late `paid` webhook can still rescue it, and returns the affected `registration_id`s for best-effort CHIP cancel.
- **Single window** — one `PAYMENT_TIMEOUT_MINUTES` (10 min) constant in `src/services/chip/chip.ts` governs the CHIP `due`, the seat hold, resume "is-live", and this expiry TTL. There's no separate longer expiry buffer: even if a read path expires a registration the instant the hold lapses, the payment row is left `pending`, and a late `paid` (only possible before `due`) settles it to `confirmed` anyway — **real money wins** (see [Confirm](#happy-path)).
- **Trigger = lazy on read** (no cron). The sweep runs, scoped, before the read:
  - per-registration in `resolvePaymentState` (after the CHIP reconcile, so a late payment is caught first; also best-effort cancels the CHIP purchase);
  - per-tournament in `getTournamentManageData` (organizer roster);
  - per-user in `GET /api/v1/me/registrations` (My Tournaments list). Bulk sweeps skip the per-row CHIP cancel — `due` already makes links unpayable.

`expire_stale_pending_payments` called with no scoping args sweeps everything, so it doubles as a future **pg_cron backstop** for rows never read again. None is scheduled today — there is no scheduler in this project (Netlify, plain `next build`/`start`).

## Files

- `src/services/chip/chip.ts` — CHIP client (`createChipPurchase` with `due`, `getChipPurchase`, `cancelChipPurchase`), `chipOutcome`, expiry constants.
- `src/app/api/v1/tournaments/[id]/checkout/route.ts` — create / continue-live / fresh-resume / initiate (saves `checkout_url`).
- `src/app/api/v1/webhooks/chip/route.ts` — signature verify + settle.
- `src/app/tournaments/[id]/register/_lib/resolvePaymentState.ts` — return-page reconcile + lazy expiry.
- `src/app/tournaments/[id]/register/page.tsx` + `_components/PaymentInProgress.tsx` — Continue-payment screen for a live pending payment.
- DB functions are flattened into two files: `db/migrations/007_payment_functions.sql` (`compute_registration_amounts`, `create_registration_with_payment`, `start_new_payment_attempt`, `settle_registration_payment`, `expire_stale_pending_payments`) and `db/migrations/003_functions_triggers.sql` (`assert_tournament_capacity` + the `check_tournament_capacity` INSERT trigger). `payments.checkout_url` and the `cancelled_payment` resume path live in `001_tables.sql` / `007`.
