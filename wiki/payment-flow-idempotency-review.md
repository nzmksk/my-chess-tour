# Payment Flow Idempotency Review — MY Chess Tour (CHIP)

## Context

The payment stack (CHIP gateway, added in #341) was reviewed for idempotency of

1. the checkout API that initiates payment and
2. the webhook that settles it.

The goal of this document is to record what is already correct, the gaps that can lead to duplicate charges or wrong settlement, and a concrete remediation plan if we choose to harden it.

## Reviewed files:

- src/app/api/v1/tournaments/[id]/checkout/route.ts — checkout / payment init
- src/app/api/v1/webhooks/chip/route.ts — webhook handler
- src/services/chip/chip.ts — CHIP client + chipOutcome mapping
- src/app/tournaments/[id]/register/\_lib/resolvePaymentState.ts — return-page reconcile
- db/migrations/008_confirm_payment.sql — settle_registration_payment
- db/migrations/009_resume_payment.sql, 010_reservation_ttl.sql — create / resume RPCs

## Verdict

- Webhook settlement: idempotent. ✅ Same event delivered N times is safe.
- Checkout / payment initiation: NOT fully idempotent. ⚠️ It can leave multiple live CHIP purchases against one payment row, which the DB-level guard does not protect against — opening a real double-charge path.

## What's already correct

1.  Settlement is genuinely idempotent. settle_registration_payment (008) does SELECT ... FOR UPDATE then acts only IF status = 'pending'. The state machine is monotonic (pending → paid|failed), so CHIP retries and the return-page reconcile (resolvePaymentState) collapse to a no-op. It returns already_processed for observability.
2.  Signature verified over the raw body (RSA-SHA256, x-signature) before any parsing — correct order.
3.  Sensible HTTP semantics for retries: 200 ack for pending/no-match/done, 500 for transient DB errors (CHIP retries), 401 for bad signature.
4.  Reconcile path reuses the same RPC — webhook and return page can't drift.
5.  Registration creation is atomic via create_registration_with_payment - capacity row-lock; UNIQUE (user_id, tournament_id) prevents duplicate registrations.

## Findings (ordered by severity)

### F1 — Double-charge via orphaned CHIP purchases (HIGH)

Resume/retry (reset_registration_for_payment, 010) sets chip_transaction_id = NULL, then initiateChipPayment creates a new CHIP purchase and overwrites the id. The previous CHIP purchase is never cancelled (no cancel call exists anywhere in chip.ts), and CHIP does not auto-void it. So a user who returns to checkout, or has two tabs/emails, holds two payable checkout links for the same payment row.

- Pay purchase B → payment paid, registration confirmed.
- Later pay purchase A → webhook can't match chip_transaction_id (it now holds B), falls back to reference = payment.id, finds the payment, but status is no longer pending → settlement no-ops.
- Net effect: money captured twice by CHIP, one registration, no refund triggered. The idempotency guard protects the record, not the money.

### F2 — Settlement never verifies the amount (MEDIUM)

settle_registration_payment marks paid purely on outcome; it never compares what CHIP charged against payments.gross_amount_cents. Because resume can re-price for a different fee tier between attempts, paying an older purchase confirms the registration for an amount different from what was charged.

### F3 — Cross-attempt contamination via the reference fallback (MEDIUM)

reference = payment.id is stable across resets, while chip_transaction_id is cleared on each resume. A late/stale webhook from a previous purchase therefore lands on the current pending payment via the fallback and settles it — e.g. a stale purchase.payment_failure flips a fresh pending attempt to failed_payment, or a late purchase.paid from an abandoned attempt confirms it. There is no per-attempt correlation.

### F4 — Concurrent duplicate checkout returns 500 (LOW)

Two simultaneous "new registration" POSTs both read no existing row, both INSERT; UNIQUE (user_id, tournament_id) keeps data safe but the loser surfaces a unique-violation (23505) as a generic 500 INTERNAL_ERROR instead of being treated as a resume/409. Data-safe, poor UX.

### F5 — chip_transaction_id write is unchecked / not unique (LOW)

checkout/route.ts:352 updates chip_transaction_id with no error handling, and the column has only a non-unique index (002). Correlation correctness currently leans on the reference fallback (see F3) to paper over a missed write.

## Remediation plan (if we proceed)

Primary fix — guarantee a single live purchase (addresses F1, and makes F3 safe):

1.  Add cancelChipPurchase(id) to src/services/chip/chip.ts calling CHIP's POST /purchases/{id}/cancel/.
2.  In checkout/route.ts, before re-pricing in the resume branch, read the existing payments.chip_transaction_id and, if set, cancel that purchase (best-effort, log on failure) before reset_registration_for_payment nulls it and a new purchase is created. This ensures at most one payable link.

Defense in depth: 3. F2 — amount check at settlement. Pass the CHIP-reported paid amount into settle_registration_payment (new p_amount_cents arg) and only confirm when it matches gross_amount_cents; otherwise mark for manual review / log. The webhook payload / getChipPurchase must surface the amount (extend the CHIP types in chip.ts). 4. F3 — tighten correlation. Once F1 ensures a single live purchase, prefer matching strictly on chip_transaction_id; treat a reference-only match whose incoming id differs from the stored chip_transaction_id as stale (ack 200, do nothing) rather than settling. 5. F4 — handle 23505 in the create branch: on unique violation, re-read the registration and route into the resume path (or return a clean 409). 6. F5 — check the update error on chip_transaction_id; consider a partial UNIQUE index on chip_transaction_id WHERE chip_transaction_id IS NOT NULL.

Migrations: changes to settle_registration_payment go in a new forward migration (e.g. 011_settle_amount_check.sql); do not edit 008 in place.

## Verification

- Unit/RPC: extend resolvePaymentState.test.ts; add SQL tests that call settle_registration_payment twice and assert the second returns already_processed:true with no state change, and that a mismatched amount is rejected.
- Manual (CHIP sandbox):
  - Start checkout, abandon, resume → confirm the first purchase is cancelled in the CHIP dashboard and only one link is payable.
  - Pay, then replay the same webhook (curl with captured signature) → no double effect.
  - Pay an intentionally-stale (pre-resume) purchase → confirm it does not settle the current payment.
- Regression: happy-path checkout → webhook → confirmed.
