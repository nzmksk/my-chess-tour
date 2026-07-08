# Payment flow

How a player pays to register for a tournament, end to end. Payments go through **CHIP** (gate.chip-in.asia). Money state is enforced authoritatively in Postgres (SECURITY DEFINER functions + row locks) so concurrent webhooks, browser returns, and resumes can't corrupt it. For webhook signing/events see [chip-webhook.md](./chip-webhook.md). For money going back to players when a tournament is cancelled, see [refund-flow.md](./refund-flow.md).

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

1. **Checkout** — `POST /api/v1/tournaments/[slug]/checkout` (`src/app/api/v1/tournaments/[slug]/checkout/route.ts`). Auth required. Validates tournament is `published`, registration deadline, fee-tier validity (incl. `valid_until`), and profile-based restrictions/eligibility.
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

The CHIP redirect to `…/register/success` or `…/register/failure` can land _before_ the webhook. Both pages call `resolvePaymentState(tournamentId, userId)` (`src/app/tournaments/[slug]/register/_lib/resolvePaymentState.ts`), which:

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

## Regression testing

Three layers, cheapest first. Run **A** on every change; add **B** when touching the DB money functions (`007`/`003`); run **C** before a release or when changing the CHIP integration.

### A. Automated suite — `npm run test` (vitest)

Mocks the Supabase RPCs and the CHIP client, so it exercises the route/handler logic, **not** the SQL.
Key files and what each pins down:

- `…/webhooks/chip/__tests__/route.test.ts` — signature verify (valid / quoted-key+`\n` / missing key → 401), `paid` settle + amount forwarding, `reference`-fallback correlation, intermediate event → ack, no-match → ack 200, transient DB error → 500 (CHIP retries).
- `…/tournaments/[slug]/checkout/__tests__/route.test.ts` — create-new, live-resume same tier (reuse link), tier-change lock (`409`), **no-link fallthrough** (CHIP-create failed), lapsed/`failed_payment`/`cancelled_payment` fresh-start + re-price, prior-purchase cancel (and cancel-fails-still-resumes), already-confirmed `409`, capacity-full `422`, non-resumable `409`, **CHIP-create failure → `503`**, **concurrent create race (`23505`) → resume the winner**.
- `…/register/_lib/__tests__/resolvePaymentState.test.ts` — return-page reconcile: pending→paid/error, **failed_payment→paid rescue** and failed_payment-stays-failed, amount-mismatch stays pending, expiry sweep (terminalized / nothing / no-`chip_transaction_id`), network-error degrades to pending.
- `…/me/registrations/__tests__/route.test.ts`, `services/payments/__tests__/fees.test.ts` — list-sweep and commission math.

### B. DB money-state scenarios — `db/tests/settle_registration_payment.sql`

The vitest layer can't reach the settlement/supersession/expiry SQL (it mocks the RPCs), so the money-loss-critical paths are covered here. Paste the script into the **Supabase SQL editor** (service role) after applying the migrations. It builds throwaway fixtures and is wrapped in `BEGIN … ROLLBACK`, so it **persists nothing**; it prints `ALL SCENARIOS PASSED` or `RAISE`s on the first failure. Scenarios:

- **S1** decline (`paid=false`) then retry-success on the **same** payment → `confirmed`/`paid` (the "real money wins" fix).
- **S2** supersede A with B via `start_new_payment_attempt`, then a late `paid` for A → `confirmed`, `current_payment_id` points at A.
- **S3a** duplicate `paid` is idempotent. **S3b** amount mismatch leaves it `pending_payment`/`pending` + `amount_mismatch=true`. **S3c** a stray late failure never overrides a `paid` row.
- **S4** a stale hold expires to `cancelled_payment` while the payment stays `pending`. **S5** a late `paid` then rescues that just-expired registration.

### C. End-to-end manual (CHIP sandbox)

Drive a real checkout and inspect the two rows (`registrations.status`, `payments.status`). Steps:

1. **Happy path** — register → pay on CHIP → land on `/register/success`. Expect `confirmed`/`paid` (webhook **and** the return-page reconcile agree).
2. **Decline → retry** — on the CHIP payform, fail once (test-decline card) then retry successfully on the **same** purchase. Expect `confirmed`/`paid` — verifies CHIP allows same-purchase retry (the premise of S1/#1).
3. **Cancel on CHIP** — start checkout, cancel on the payform. Expect `failed_payment`/`failed`.
4. **Abandon, resume live** — start checkout, close the tab, return to the register page within 10 min. Expect the **Continue-payment** card with the same link + a different-tier request blocked (`409`).
5. **Abandon, resume after expiry** — wait out the 10-min hold, reload. Expect the tier form back (row swept to `cancelled_payment`), and a fresh resume issues a new link/timer.
6. **Webhook-before / after return** — to exercise the race, pay and immediately return: the success page must reconcile to `confirmed` even if the webhook is slow (or arrives first). Both orders must end `confirmed`/`paid` exactly once.

### Scenario coverage matrix

| Scenario | Covered by | Expected end state (registration / payment) |
|---|---|---|
| Happy path | A (webhook+checkout), C-1 | `confirmed` / `paid` |
| Return-before-webhook reconcile | A (resolve), C-6 | `confirmed` / `paid` |
| Resume live, same tier | A (checkout) | unchanged `pending_payment` / `pending`, same link |
| Resume live, different tier | A (checkout), C-4 | `409`, unchanged |
| Resume live, no stored link | A (checkout) | fresh attempt issued |
| Resume lapsed / `failed_payment` / `cancelled_payment` | A (checkout), C-5 | new `pending` attempt (re-priced) |
| Prior CHIP purchase cancelled on resume | A (checkout) | prior link unpayable; best-effort |
| Decline → retry-success (same purchase) | B-S1, A (resolve), C-2 | `confirmed` / `paid` |
| Superseded attempt later paid | B-S2 | `confirmed` / `paid` (points at paid attempt) |
| Cancel on CHIP | A (webhook), C-3 | `failed_payment` / `failed` |
| Network: CHIP-create fails | A (checkout → 503), C | unchanged `pending` (no link); recover via resume |
| Network: webhook DB error | A (webhook → 500) | unchanged; CHIP retries |
| Network: reconcile throws | A (resolve → pending) | unchanged `pending_payment` |
| Expiry (no CHIP event) | B-S4, A (resolve) | `cancelled_payment` / `pending` |
| Late paid rescues expired | B-S5 | `confirmed` / `paid` |
| Idempotency: duplicate paid | B-S3a, A (webhook) | `confirmed` / `paid` (single effect) |
| Idempotency: paid then late failed | B-S3c | `confirmed` / `paid` |
| Amount mismatch | B-S3b, A (resolve) | `pending_payment` / `pending` + `amount_mismatch` |
| Capacity full (create / resume) | A (checkout → 422), DB trigger | no row created / unchanged |
| Concurrent double-submit (create) | A (checkout, `23505` recovery) | one winner, resumed |
| Bad webhook signature / no key | A (webhook → 401) | unchanged |

## Files

- `src/services/chip/chip.ts` — CHIP client (`createChipPurchase` with `due`, `getChipPurchase`, `cancelChipPurchase`), `chipOutcome`, expiry constants.
- `src/app/api/v1/tournaments/[slug]/checkout/route.ts` — create / continue-live / fresh-resume / initiate (saves `checkout_url`).
- `src/app/api/v1/webhooks/chip/route.ts` — signature verify + settle.
- `src/app/tournaments/[slug]/register/_lib/resolvePaymentState.ts` — return-page reconcile + lazy expiry.
- `src/app/tournaments/[slug]/register/page.tsx` + `_components/PaymentInProgress.tsx` — Continue-payment screen for a live pending payment.
- `db/tests/settle_registration_payment.sql` — transaction-wrapped DB money-state regression test (see [Regression testing](#regression-testing) §B).
- DB functions are flattened into two files: `db/migrations/007_payment_functions.sql` (`compute_registration_amounts`, `create_registration_with_payment`, `start_new_payment_attempt`, `settle_registration_payment`, `expire_stale_pending_payments`) and `db/migrations/003_functions_triggers.sql` (`assert_tournament_capacity` + the `check_tournament_capacity` INSERT trigger). `payments.checkout_url` and the `cancelled_payment` resume path live in `001_tables.sql` / `007`.
