# Refund flow (tournament cancellation)

How registered players get their money back when a **published tournament is cancelled**. Refunds go back through **CHIP Collect** (`POST /purchases/{id}/refund/`) against the original purchase. Like the [payment flow](./payment-flow.md), money state is enforced authoritatively in Postgres (SECURITY DEFINER functions + row locks) so the synchronous refund response and the async webhook can't corrupt it. For webhook signing/events see [chip-webhook.md](./chip-webhook.md).

Scope: this covers **player refunds on cancellation** (issue #477). Organizer payouts / player prizes (money-out via CHIP Send) are separate — see issue #375.

## Trigger

Refunds are initiated only when a platform admin **approves** an organizer's cancellation request (see [payment-flow.md](./payment-flow.md) for how a registration becomes `confirmed` in the first place). The two-step approval itself (organizer files → admin reviews) predates this flow; approval is where the money moves.

## Data model

- **`refunds`** (`db/migrations/001_tables.sql`): approval-workflow row per registration. `status` (`refund_status`): `pending` → `approved` | `rejected`; `refund_amount_cents`, `reason`, `requested_by`, `chip_refund_id`, `processed_at`. A partial UNIQUE index `uniq_active_refund_per_registration` (`002_indexes.sql`) allows at most one live (non-rejected) refund per registration.
- **`payments`** `type='refund'`: when a refund settles, a `paid` ledger row is appended mirroring the original registration payment's **positive** magnitudes (`gross/platform_fee/organizer_commission/player_commission/net`). `tournament_payout_summary` subtracts `type='refund' AND status='paid'` rows from the registration rows, so a fully-refunded tournament reverses revenue/fees to zero. `chip_transaction_id` stores the CHIP **refund** Payment id (distinct from the original purchase id → no collision with the unique `idx_payments_chip_transaction`). `uniq_paid_refund_per_registration` (`002_indexes.sql`) is defence-in-depth against a double-book.

## Amount

**Full refund of what the player paid** — the registration payment's `gross_amount_cents`, commission included. Because the refund ledger row mirrors the registration row exactly, the platform fee is returned too (the platform eats its own commission on a cancellation).

## Flow (four phases across the DB / app boundary)

A CHIP refund is a network call and can't run inside a Postgres transaction, so the work splits:

1. **Queue (atomic DB)** — `review_tournament_cancellation()` (`003_functions_triggers.sql`), on approve, flips `tournaments.status='cancelled'` **and** inserts one `refunds` row (`pending`, amount = the paid registration payment's gross) per **confirmed** registration, all in one transaction. `pending_payment`/`failed`/`cancelled`/`forfeited` players never paid → excluded. `ON CONFLICT DO NOTHING` (against `uniq_active_refund_per_registration`) makes it idempotent.
2. **Fire (app)** — the admin PATCH route (`src/app/api/v1/admin/tournament-cancellations/[id]/route.ts`) calls `initiateCancellationRefunds()`: loads pending refunds via `list_pending_cancellation_refunds()` (`007`), then `refundChipPurchase(originalPurchaseId)` per player. Best-effort (`Promise.allSettled`, concurrency-capped at `REFUND_CONCURRENCY`), never throws — the cancellation is already committed.
3. **Settle (DB)** — `settle_refund(refund_id, chip_refund_id, paid, method)` (`007`) locks the refund, no-ops if already `processed_at`, and on `paid` appends the `type='refund'` paid ledger row + stamps the refund `approved`/`processed_at`/`chip_refund_id`. On failure it records the CHIP id but leaves the refund `pending` for retry. Called either synchronously (terminal CHIP response) or from the webhook.
4. **Webhook (authoritative async settle)** — `POST /api/v1/webhooks/chip` recognises the refund events via `chipRefundOutcome()` / `isChipRefundEvent()` (`chip.ts`), correlates `related_to` → original purchase → registration → live refund, and calls `settle_refund`. See [chip-webhook.md](./chip-webhook.md) for the events (`payment.refunded`, `purchase.refund_failure`, `purchase.pending_refund`).

## Idempotency & correlation

- **Queue**: `uniq_active_refund_per_registration` + `ON CONFLICT` → re-approving/re-running can't double-create a refund.
- **Settle**: three guards — `settle_refund` locks the refund and no-ops if `processed_at` is set; the unique `idx_payments_chip_transaction` on the refund Payment id blocks a sync-response + webhook race; `uniq_paid_refund_per_registration` is the belt-and-braces backstop.
- **Sync vs webhook**: the `200` body has **two shapes** and which one you get tells you whether the refund finished. A **Payment** object *is* the completed refund (it has no `status` field) → settle immediately, and the later `payment.refunded` webhook is a no-op. A **Purchase** with `status: "pending_refund"` means the acquirer is still processing → record nothing and let the webhook settle. Narrow with `isPendingRefund()` (`src/services/chip/interfaces/refund-response.ts`); its `id` is a *purchase* id on the pending shape, so it must not be written to `chip_refund_id`.

## Open risks / TODO

These are known gaps carried from implementation. Track before relying on this in production.

1. **`related_to` shape is unverified.** CHIP's docs only say `payment.refunded` links to the original purchase; the exact shape (`{ id }`, bare id, or URL) isn't documented. `extractRelatedPurchaseId` (`webhooks/chip/route.ts`) parses all three defensively and logs unrecognised shapes — **confirm against a real webhook sample** and tighten.
2. ~~**Synchronous `POST /refund/` response shape.**~~ **Resolved.** The shape is now modelled from CHIP's API reference in `src/services/chip/interfaces/refund-{request,response}.ts`. The endpoint never returns a `status: "refunded"` — success is a Payment object with no `status` at all, and the in-flight case is a Purchase with `status: "pending_refund"`. Discriminate on shape (`isPendingRefund`), not on `status`. Worth confirming against a real sandbox refund, since this was previously mis-modelled.
3. **Inline fan-out / serverless timeout.** Refunds fire inline in the admin PATCH request (capped at `REFUND_CONCURRENCY`). For a tournament with hundreds of confirmed players this risks the function timeout — there is **no job queue / cron** in the repo. Settlement is idempotent, so a re-fire is safe; consider moving the fire phase to a background job if large cancellations become common.
4. **No automatic retry for stuck refunds.** A refund left `pending` (CHIP down, `purchase.refund_failure`, or a missed webhook) has no auto-retry. A future ops re-fire path must **skip refunds that already have `chip_refund_id`/`processed_at`** — re-POSTing `/refund/` on an already-refunded purchase returns `400 purchase_refund_error`.
5. **Out-of-band CHIP-dashboard refunds.** A refund issued manually from CHIP's portal emits `payment.refunded` with no matching pending `refunds` row; the webhook currently **acks + logs loudly** rather than fabricating a refund. Decide whether to auto-reconcile.

Adjacent (out of scope, don't route into the refund path): `payment.charged_back` chargebacks; the registration status is intentionally **left `confirmed`** (the enum has no `refunded` value; `tournament.status='cancelled'` + the `refunds`/`payments` ledger are the authoritative refund state).

## Files

- `src/services/chip/chip.ts` — `refundChipPurchase`, `chipRefundOutcome`, `isChipRefundEvent` (registration `chipOutcome` deliberately left untouched so refund events don't leak into registration settlement).
- `src/app/api/v1/admin/tournament-cancellations/[id]/route.ts` — approve → queue (RPC) → `initiateCancellationRefunds` (fire + sync settle).
- `src/app/api/v1/webhooks/chip/route.ts` — `handleRefundEvent` (correlate + async settle).
- `db/migrations/003_functions_triggers.sql` — `review_tournament_cancellation` (queues refunds on approve).
- `db/migrations/007_payment_functions.sql` — `settle_refund`, `list_pending_cancellation_refunds`.
- `db/migrations/002_indexes.sql` — `uniq_active_refund_per_registration`, `uniq_paid_refund_per_registration`.
- `db/tests/settle_refund.sql` — transaction-wrapped DB money-state regression test (queue-on-approve, mirrored ledger row, idempotent re-settle, failure-stays-pending, retry + payout reverses to zero, duplicate-refund guard).

## Testing

- **DB**: `db/tests/settle_refund.sql` (paste into the Supabase SQL editor as service role, or run against a local Postgres with `001`/`002`/`003`/`007` applied). Rolls back; prints `ALL SCENARIOS PASSED`.
- **Unit** (`npm run test`): refund cases in `webhooks/chip/__tests__/route.test.ts` and `admin/tournament-cancellations/[id]/__tests__/route.test.ts`, plus `src/services/chip/__tests__/chip.test.ts`.
