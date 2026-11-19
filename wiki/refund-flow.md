# Refund flow (tournament cancellation)

How registered players get their money back when a **published tournament is cancelled**. Refunds go back through **CHIP Collect** (`POST /purchases/{id}/refund/`) against the original purchase. Like the [payment flow](./payment-flow.md), money state is enforced authoritatively in Postgres (SECURITY DEFINER functions + row locks) so the synchronous refund response and the async webhook can't corrupt it. For webhook signing/events see [chip-webhook.md](./chip-webhook.md).

Scope: this covers **player refunds on cancellation** (issue #477) — the only path that creates a `refunds` row today — plus where players and organizers see a refund (#511) and the refund outcome emails (#512). Out of scope here, each tracked separately: player-initiated refund requests (#509), organizer refunds from the participant roster (#510), an admin list of all refunds (owned by the transactions screen, #109/#110), and organizer payouts / player prizes via CHIP Send (#375).

## Trigger

Refunds are initiated only when a platform admin **approves** an organizer's cancellation request (see [payment-flow.md](./payment-flow.md) for how a registration becomes `confirmed` in the first place). The two-step approval itself (organizer files → admin reviews) predates this flow; approval is where the money moves.

## Data model

- **`refunds`** (`db/migrations/001_tables.sql`): approval-workflow row per registration. `status` (`refund_status`): `pending` → `approved` | `rejected`; `refund_amount_cents`, `reason`, `requested_by`, `chip_refund_id`, `processed_at`, `failed_at` (first CHIP-reported failure; kept as history after a successful retry), `last_fired_at` (when the app last asked CHIP for it; see [Stuck refunds](#stuck-refunds-and-the-re-fire-497)). A partial UNIQUE index `uniq_active_refund_per_registration` (`002_indexes.sql`) allows at most one live (non-rejected) refund per registration.
- **`payments`** `type='refund'`: when a refund settles, a `paid` ledger row is appended mirroring the original registration payment's **positive** magnitudes (`gross/platform_fee/organizer_commission/player_commission/net`). `tournament_payout_summary` subtracts `type='refund' AND status='paid'` rows from the registration rows, so a fully-refunded tournament reverses revenue/fees to zero. `chip_transaction_id` stores the CHIP **refund** Payment id (distinct from the original purchase id → no collision with the unique `idx_payments_chip_transaction`). `uniq_paid_refund_per_registration` (`002_indexes.sql`) is defence-in-depth against a double-book.

## Amount

**Full refund of what the player paid** — the registration payment's `gross_amount_cents`, commission included. Because the refund ledger row mirrors the registration row exactly, the platform fee is returned too (the platform eats its own commission on a cancellation).

## Flow (four phases across the DB / app boundary)

A CHIP refund is a network call and can't run inside a Postgres transaction, so the work splits:

1. **Queue (atomic DB)** — `review_tournament_cancellation()` (`003_functions_triggers.sql`), on approve, flips `tournaments.status='cancelled'` **and** inserts one `refunds` row (`pending`, amount = the paid registration payment's gross) per **confirmed** registration, all in one transaction. `pending_payment`/`failed`/`cancelled`/`forfeited` players never paid → excluded. `ON CONFLICT DO NOTHING` (against `uniq_active_refund_per_registration`) makes it idempotent.
2. **Fire (app, off the request)** — the **refund sweep** (`POST /api/v1/cron/refunds` → `sweepUnfiredRefunds()`, `src/services/refunds/sweep.ts`), not the admin's request; see [The refund sweep](#the-refund-sweep-496). It loads unfired refunds via `list_unfired_cancellation_refunds()` (`006`), then calls `fireRefund()` (`src/services/refunds/fire.ts`) for each, `REFUND_CONCURRENCY` (5) at a time. `fireRefund` first calls `claim_refund_fire()` (`006`), which stamps `last_fired_at` under a row lock and hands back the original purchase id, then `refundChipPurchase(originalPurchaseId)`. Best-effort, never throws: a refund that doesn't go through stays pending.
3. **Settle (DB)** — `settle_refund(refund_id, chip_refund_id, paid, method)` (`006`) locks the refund, no-ops if already `processed_at`, and on `paid` appends the `type='refund'` paid ledger row + stamps the refund `approved`/`processed_at`/`chip_refund_id`. On failure it records the CHIP id, stamps `failed_at` (first time only), and leaves the refund `pending` for retry. Called either synchronously (terminal CHIP response) or from the webhook. It reports `newly_settled` / `newly_failed`: whether *this* call did the work.
4. **Webhook (authoritative async settle)** — `POST /api/v1/webhooks/chip` recognises the refund events via `chipRefundOutcome()` / `isChipRefundEvent()` (`chip.ts`), correlates `related_to` → original purchase → registration → live refund, and calls `settle_refund`. See [chip-webhook.md](./chip-webhook.md) for the events (`payment.refunded`, `purchase.refund_failure`, `purchase.pending_refund`).

## Idempotency & correlation

- **Queue**: `uniq_active_refund_per_registration` + `ON CONFLICT` → re-approving/re-running can't double-create a refund.
- **Settle**: three guards — `settle_refund` locks the refund and no-ops if `processed_at` is set; the unique `idx_payments_chip_transaction` on the refund Payment id blocks a sync-response + webhook race; `uniq_paid_refund_per_registration` is the belt-and-braces backstop.
- **Sync vs webhook**: the `200` body has **two shapes** and which one you get tells you whether the refund finished. A **Payment** object *is* the completed refund (it has no `status` field) → settle immediately, and the later `payment.refunded` webhook is a no-op. A **Purchase** with `status: "pending_refund"` means the acquirer is still processing → record nothing and let the webhook settle. Narrow with `isPendingRefund()` (`src/services/chip/interfaces/refund-response.ts`); its `id` is a *purchase* id on the pending shape, so it must not be written to `chip_refund_id`.

## Who sees what (#511)

A refund reads as one of three states (`refundState`, `src/lib/refunds/state.ts`): **refunded** (`processed_at` set), **failed** (`failed_at` set, nothing cleared since; the refund is still owed), or **processing**.

- **Player**: `/my` (My Tournaments). `GET /api/v1/me/registrations` returns each registration's live refund (state, amount, requested/cleared dates). An entry in a cancelled tournament sits under **Cancelled** with a "Tournament Cancelled" badge, and the card shows "Refund of RM 55.00 processing", "Refunded RM 55.00 on 11 Mar 2026 (MYT)", or a failed refund with the support address. RLS: "Players can view refunds of own registrations" scopes on the registration's owner, not `requested_by` (which is the reviewing admin for a cancellation refund).
- **Organizer**: the tournament manage page shows a **Refunds** section once refunds exist (player, amount, state, date, totals by state), explaining the drop in the tournament's revenue and `net_payout_cents`. Gated on `refund.manage`, the same gate as the "Org refund managers can view tournament refunds" policy. The platform admin's read-only view of the page shows it too.
- **Admin, stuck refunds**: `/admin/refunds` lists refunds stuck in `pending` across tournaments, with a retry each, and the admin dashboard shows a banner while any are stuck. See [Stuck refunds](#stuck-refunds-and-the-re-fire-497).
- **Admin, every refund across tournaments**: not here. The transactions screen (#109, #110) owns the full cross-tournament list.

## Outcome emails (#512)

`notifyRefundSettlement()` (`src/services/refunds/notify.ts`) sends **refund completed** (amount, the method it went back to, the usual 5–14 working day posting delay) or **refund failed** (the money is still owed; contact support). Templates: `refund-completed.html`, `refund-failed.html`.

Both settle paths hand it `settle_refund`'s result: `fireRefund` (from the sweep or an admin retry) on a terminal CHIP response, and the webhook on `payment.refunded` / `purchase.refund_failure`. It sends only on `newly_settled` or `newly_failed`, so a refund settled by both the sync response and the webhook emails once, and a redelivered failure doesn't email again. A refund that fails, is retried and then clears gets one failure email and one completed email. Best-effort and sent after the response: a send failure never fails the webhook (CHIP would redeliver the settle), the sweep, or the admin's retry.

The admin route sends the cancellation notice after its response, and the sweep leaves a refund alone for `REFUND_SWEEP_GRACE_INTERVAL` (1 minute) after it was queued, so "refund completed" can't arrive ahead of "tournament cancelled". A synchronous failure (the CHIP call throws, or answers with a failure status) records nothing and sends nothing: only the `purchase.refund_failure` webhook marks a refund failed.

## The refund sweep (#496)

Approving a cancellation used to fire every refund inside the admin's PATCH. For a tournament with hundreds of confirmed players that can outlast the serverless function's time limit, leaving the remainder unfired. Now the approval only queues the refunds (phase 1) and a scheduled sweep fires them.

- **Trigger.** `.github/workflows/cancellation-refunds.yml` runs every 5 minutes (GitHub's shortest schedule, and runs can start late) and POSTs `/api/v1/cron/refunds` with `CRON_SECRET`, like the payout and FIDE crons. Also runnable on demand from the Actions tab.
- **Chunked.** One call loads up to 100 refunds and stops starting new CHIP calls once `REFUND_SWEEP_BUDGET_MS` (6s) has passed. That budget fits the tightest synchronous limit the app may run under (Netlify can hold functions to 10s). The response is `{ fired, outcomes, more }`, and the workflow calls again while `more` is true, up to 40 calls a run. A run that doesn't finish leaves the rest to the next.
- **The work list.** `list_unfired_cancellation_refunds(p_min_age, p_limit)` returns pending, unsettled refunds with `last_fired_at` NULL on **cancelled** tournaments, oldest first. It leaves out refunds queued inside the grace period, ones with no CHIP purchase (the claim refuses those unstamped, so every run would retry them; they reach the stuck list instead), and refunds on tournaments that aren't cancelled, so a future player-requested refund awaiting review (#509) is never fired by it.
- **One shot.** A refund leaves the list the moment it is claimed. If it then doesn't settle (CHIP down, refused, failed, the function stopped mid-call), the sweep never retries it: once it is `REFUND_STUCK_AFTER_MINUTES` old it is on the Stuck refunds page below. The first fire skips the CHIP read the re-fire does: nothing can have moved on a refund nobody has fired.
- **Overlap is safe.** Two sweeps, or a sweep and an admin's Retry, both go through `claim_refund_fire`, so CHIP is called once.
- **Not stuck yet.** Every refund now starts out unfired, so `list_stuck_refunds` counts a never-fired refund only once it was queued `REFUND_STUCK_AFTER_MINUTES` ago. Before that the sweep hasn't had its chance, and the dashboard banner shouldn't go red on every approval.

The sweep workflow uses the existing `CRON_SECRET` and `PRODUCTION_URL` repository secrets.

## Stuck refunds and the re-fire (#497)

Nothing retries a pending refund on its own. A refund gets stuck when the sweep never reached it, CHIP was down or refused the call, CHIP sent `purchase.refund_failure`, or the settling webhook was missed or mis-correlated (including an acquirer that answered `pending_refund` and then went quiet). The re-fire is how an admin gets it moving again.

**Stuck vs. in flight.** `pending` is overloaded: a refund fired a moment ago and waiting on its `payment.refunded` webhook looks exactly like a stuck one. `refunds.last_fired_at` tells them apart. `refund_fire_due()` (`006`) says a refund may be fired again when it was **never fired**, was fired at least `REFUND_STUCK_AFTER_MINUTES` (15, `src/lib/refunds/stuck-after.ts`) ago with nothing settling it. A reported failure doesn't shorten that wait: `purchase.refund_failure` is correlated only by the original purchase, so a late failure from an earlier fire looks the same as one for the latest fire, and letting it make the refund due would let a second claim through while the latest fire is still reconciling or POSTing. `list_stuck_refunds()` and `claim_refund_fire()` both use it, so the list and the button can't disagree. The list also holds back a never-fired refund queued less than the threshold ago (the sweep's to fire), so it stays a subset of what the claim accepts.

**The claim.** Every fire, first or retry, goes through `claim_refund_fire(refund_id, min_age)`. It locks the row and refuses, without stamping:
- `settled`: `processed_at` or `chip_refund_id` is set, or the refund is `approved`. Re-POSTing `/refund/` on a refunded purchase returns `400 purchase_refund_error`. `settle_refund` would shrug off a repeat, but CHIP shouldn't be asked to move the money twice.
- `rejected`, `not_found`.
- `in_flight`: not due yet.
- `no_purchase`: the registration payment has no CHIP purchase. Left unstamped so it stays on the list for someone to refund by hand.

Otherwise it stamps `last_fired_at = now()` and returns the purchase id. The lock means two admins pressing Retry together (or a retry racing the sweep) reach CHIP once.

**Reconcile before re-POSTing.** The admin re-fire (`fireRefund(id, { reconcile: true })`) reads the purchase from CHIP (`getChipPurchase`) before refunding, because the cases it exists for can leave money that already moved:
- `refunded` with nothing left refundable: the money went back and we never heard. Settled from CHIP's record: the refund Payment id comes from the `status_history` entry for `refunded` (its `related_object`), the player gets the completed email, and the late webhook (if it ever comes) is a no-op. Outcome `reconciled`.
- `refunded` with `refundable_amount > 0`: partly refunded at CHIP (an out-of-band refund, #498). Not settled as a full refund; left for a person. Outcome `needs_attention`.
- `pending_refund`: CHIP is still on it. Not re-POSTed. Outcome `processing`.
- anything else: POST `/refund/` as on the first fire.
- CHIP can't be read: nothing is POSTed blind. Outcome `error`.

The first fire, from the sweep, skips this read: nothing can have moved yet, and it would halve how many refunds each time-boxed sweep call gets through.

**Where admins see it.** `/admin/refunds` (`StuckRefundsClient`) lists stuck refunds, oldest first, with player, tournament, amount, when it was requested / last sent / first failed, why it is stuck (never sent, no answer, failed, no CHIP purchase) and a **Retry refund** button (`POST /api/v1/admin/refunds/[id]/refire`, answers 200 with the outcome, 404 for an unknown refund). The admin dashboard shows a red banner linking there while any refund is stuck, and says so if it couldn't check rather than showing nothing. `GET /api/v1/admin/refunds` returns the same list.

## Open risks / TODO

These are known gaps carried from implementation. Track before relying on this in production. Each
has an issue: #495 (1), #498 (5), plus **#499** for refund monitoring/metrics. A refund
stuck in `pending` is no longer silent (4, resolved by #497): it shows on the admin dashboard. The
inline fan-out (3) is resolved by #496: refunds are fired by a scheduled sweep.

**Resolved:** the async settle path's one ops dependency is satisfied — `checkout/route.ts` sets no
`success_callback`, so refund callbacks arrive only via the **company-level** webhook, and that
subscription includes `payment.refunded`, `purchase.refund_failure`, and `purchase.pending_refund`.
If that subscription is ever narrowed, phase 4 dies silently.

1. **`related_to` shape is unverified.** CHIP's docs only say `payment.refunded` links to the original purchase; the exact shape (`{ id }`, bare id, or URL) isn't documented. `extractRelatedPurchaseId` (`webhooks/chip/route.ts`) parses all three defensively and logs unrecognised shapes — **confirm against a real webhook sample** and tighten.
2. ~~**Synchronous `POST /refund/` response shape.**~~ **Resolved.** The shape is now modelled from CHIP's API reference in `src/services/chip/interfaces/refund-{request,response}.ts`. The endpoint never returns a `status: "refunded"` — success is a Payment object with no `status` at all, and the in-flight case is a Purchase with `status: "pending_refund"`. Discriminate on shape (`isPendingRefund`), not on `status`. Worth confirming against a real sandbox refund, since this was previously mis-modelled.
3. ~~**Inline fan-out / serverless timeout.**~~ **Resolved (#496).** The approval only queues refunds; the [refund sweep](#the-refund-sweep-496) fires them off the request in time-boxed, concurrency-capped chunks that a 5-minute GitHub Actions schedule drains. Remaining caveat: a CHIP refund call has no client-side timeout, so a hung call can still hold one sweep call past its budget; the claimed refund then surfaces on the stuck list after 15 minutes.
4. ~~**No automatic retry for stuck refunds.**~~ **Resolved (#497)** with an ops re-fire: stuck refunds are listed at `/admin/refunds` and flagged on the admin dashboard, and each can be retried. The claim skips refunds with `chip_refund_id`/`processed_at`, and the retry checks the purchase at CHIP before re-POSTing. See [Stuck refunds](#stuck-refunds-and-the-re-fire-497). Still manual: the refund sweep (#496) fires each refund once and never retries it. It could take on stuck refunds too (with the re-fire's CHIP check) if hand-retrying becomes a chore.
5. **Out-of-band CHIP-dashboard refunds.** A refund issued manually from CHIP's portal emits `payment.refunded` with no matching pending `refunds` row; the webhook currently **acks + logs loudly** rather than fabricating a refund. Decide whether to auto-reconcile.

Adjacent (out of scope, don't route into the refund path): `payment.charged_back` chargebacks; the registration status is intentionally **left `confirmed`** (the enum has no `refunded` value; `tournament.status='cancelled'` + the `refunds`/`payments` ledger are the authoritative refund state).

## Files

- `src/services/chip/chip.ts` — `refundChipPurchase`, `chipRefundOutcome`, `isChipRefundEvent` (registration `chipOutcome` deliberately left untouched so refund events don't leak into registration settlement).
- `src/app/api/v1/admin/tournament-cancellations/[id]/route.ts` — approve → queue (RPC). Fires nothing.
- `src/app/api/v1/cron/refunds/route.ts` + `.github/workflows/cancellation-refunds.yml` — the refund sweep's trigger; `src/services/refunds/sweep.ts` — `sweepUnfiredRefunds` (time-boxed, concurrency-capped first fire).
- `src/services/refunds/fire.ts` — `fireRefund` (claim → optional CHIP reconcile → refund → sync settle); `src/lib/refunds/stuck-after.ts` — the stuck threshold.
- `src/services/refunds/stuck.ts` — `loadStuckRefunds`; `src/app/api/v1/admin/refunds/route.ts` (list) and `[id]/refire/route.ts` (retry); `src/app/admin/refunds/` — the Stuck refunds page; the admin dashboard's `stuck_refunds` count and banner.
- `src/app/api/v1/webhooks/chip/route.ts` — `handleRefundEvent` (correlate + async settle).
- `db/migrations/003_functions_triggers.sql` — `review_tournament_cancellation` (queues refunds on approve).
- `db/migrations/006_payment_functions.sql` — `settle_refund`, `list_unfired_cancellation_refunds`, `refund_fire_due`, `claim_refund_fire`, `list_stuck_refunds`.
- `db/migrations/004_rls.sql` — "Players can view refunds of own registrations", "Org refund managers can view tournament refunds".
- `src/services/refunds/notify.ts` — `notifyRefundSettlement` (outcome emails); `src/services/chip/payment-method-label.ts` — `describePaymentMethod`.
- `src/lib/refunds/state.ts` — `refundState`, `liveRefund`.
- `src/app/api/v1/me/registrations/route.ts` + `src/app/my/tournaments/_components/RegistrationsClient.tsx` — player view; `src/app/my/organizations/[orgId]/tournaments/[id]/_data/getTournamentManageData.ts` + `_components/TournamentManageClient.tsx` — organizer view.
- `db/migrations/002_indexes.sql` — `uniq_active_refund_per_registration`, `uniq_paid_refund_per_registration`.
- `db/tests/settle_refund.sql` — transaction-wrapped DB money-state regression test (queue-on-approve, mirrored ledger row, idempotent re-settle, failure-stays-pending, `newly_settled`/`newly_failed` once each, retry + payout reverses to zero, duplicate-refund guard). `db/tests/refund_writes.sql` F5 — a player reads their own cancellation refund, not another player's. `db/tests/refund_refire.sql` — stuck vs. in flight, the claim's refusals (settled / chip id / rejected / in flight / no purchase), and the list matching the claim. `db/tests/refund_sweep.sql` — the sweep's work list (grace period, order, limit; fired / settled / rejected / no purchase / not cancelled left out).

## Testing

- **DB**: `db/tests/settle_refund.sql`, `db/tests/refund_refire.sql` and `db/tests/refund_sweep.sql` (paste into the Supabase SQL editor as service role, or run against a local Postgres with `001`/`002`/`003`/`006` applied). Each rolls back and prints `ALL SCENARIOS PASSED`.
- **Unit** (`npm run test`): refund cases in `webhooks/chip/__tests__/route.test.ts`, `admin/tournament-cancellations/[id]/__tests__/route.test.ts` (fires nothing), the sweep in `src/services/refunds/__tests__/sweep.test.ts` and `cron/refunds/__tests__/route.test.ts`, plus `src/services/chip/__tests__/chip.test.ts`. The re-fire: `src/services/refunds/__tests__/{fire,stuck}.test.ts`, `admin/refunds/**/__tests__/route.test.ts`, `src/app/admin/refunds/_components/__tests__/StuckRefundsClient.test.tsx`, and the dashboard tests.
