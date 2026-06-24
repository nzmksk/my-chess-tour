Critical

C1 — No CHIP payment webhook exists. There's no _webhook_/_chip_ route under src/app/api. Payments are created pending and registrations pending_payment, and nothing ever flips them to paid/confirmed. The RLS comment in 004_rls.sql even assumes webhooks that don't exist. No registration can ever reach confirmed — the paid flow is non-functional.

Update (testing): The webhook (src/app/api/v1/webhooks/chip/route.ts) and migration 008 (settle_registration_payment) are now in place. Two blockers were found during testing and fixed:

1. Localhost callback — NEXT_PUBLIC_SITE_URL was http://localhost:3000 (in .env.local and .env.staging), which CHIP cannot reach, so the callback never arrived. Test on a publicly reachable URL (Netlify/tunnel). Also fix .env.staging NEXT_PUBLIC_SITE_URL (still localhost).
2. Wrong reference field — chip.ts created purchases with reference_id, but CHIP's Purchase object uses reference (reference_id is ignored), so the purchase.paid payload carried no reference and the handler logged "missing reference_id" and skipped the update. Fixed: chip.ts now sends reference, and the webhook correlates on the CHIP purchase id (payload.id == payments.chip_transaction_id, always set after checkout) with reference as fallback. NOTE: purchases created before this fix have no stored reference but are still correlatable by chip_transaction_id.

Separately, failure events require a CHIP dashboard webhook subscribed to purchase.payment_failure pointed at /api/v1/webhooks/chip; success_callback fires on success only.

Verification

- No warning logs related to payment flow

C2 — Success page lies about payment. register/success/page.tsx is static, keyed only on tournament id. It unconditionally says "Payment Successful. Your registration is now active" without reading any record or checking CHIP. Anyone can hit the URL directly; users whose payment failed still see success.

FIXED: Both success/page.tsx and failure/page.tsx now authenticate the user and call resolvePaymentState (src/app/tournaments/[id]/register/\_lib/resolvePaymentState.ts), which reads the user's registration (unique per user+tournament) and, if still pending_payment, reconciles against CHIP via getChipPurchase + the idempotent settle_registration_payment RPC (handles the case where the browser redirect beats the webhook). Rendering branches on the real state via PaymentStatusView: confirmed → success; pending → "confirming payment"; failed → retry; none/unauthenticated → neutral card (never a false "successful"). The CHIP status→outcome mapping is centralized in chipOutcome (src/services/chip/chip.ts) and shared with the webhook so they can't drift. Unit tests: resolvePaymentState.test.ts.

Verification

- after payment, redirect page is rendered based on CHIP payment state
  - success
  - pending
  - failed

High

H1 — Resume-payment ignores the newly chosen fee tier (checkout/route.ts:236-237). For an existing pending_payment/failed_payment registration it resumes with existing.id and discards the new fee_tier from the request — the user is re-charged the original amount even if they picked a cheaper tier.

FIXED (with H2): the resume branch now calls reset_registration_for_payment (migration 009) with the chosen fee_tier + amount, which re-prices the registration + payment before initiating a fresh CHIP purchase.

H2 — failed_payment resume is broken (checkout/route.ts:280-285). initiateChipPayment fetches the payment with .eq("status","pending").single(). A failed payment isn't pending, so .single() errors → 500 "Payment record not found." (Latent today only because nothing sets failed_payment yet — see C1.)

FIXED: reset_registration_for_payment (migration 009) resets the payment to status='pending' (clearing chip_transaction_id/paid_at) before initiateChipPayment runs, so the pending lookup succeeds. (Note: failed_payment is now live — set by the webhook and the C2 reconcile — so this is no longer latent.) Single source for the charge math: compute_registration_amounts, shared by create_registration_with_payment and reset_registration_for_payment. Tests: checkout/**tests**/route.test.ts.

H3 — Pending registrations consume capacity forever. Capacity counts pending_payment + confirmed (checkout/route.ts:95-106 + the check_tournament_capacity trigger), and there's no expiry/cleanup. With no webhook (C1), every abandoned checkout permanently eats a slot; tournaments fill with ghosts and become un-registerable.

FIXED: 10-minute lazy hold window enforced entirely in Postgres (migration 010). assert_tournament_capacity(tournament_id, exclude?) counts confirmed + pending_payment within the last 10 minutes (locking the tournament row); check_tournament_capacity delegates to it, so abandoned pendings drop out of the count and slots free automatically — no scheduler. reset_registration_for_payment now also re-checks capacity (excluding its own row) and resets registered_at, closing an overbook hole where the resume UPDATE bypassed the INSERT-only trigger. The redundant JS capacity pre-check in checkout was removed (counted all pending with no window; blocked users paying for their own held slot) — also resolves M3 for checkout. Capacity stays Postgres-only (Upstash REST Redis can't share the transaction); pg_cron cleanup sweep + Redis display-count cache deferred. Caveat: a payment confirmed after its hold lapsed has no confirm-time recheck (rare overbook).

Verification

- Apply migration 010 to Supabase (manual, as with 001–009; all CREATE OR REPLACE / additive).
- Manual (10-min window):
  - fill a 1-seat tournament with one pending_payment;
  - before 10 min another user gets CAPACITY_FULL;
  - after 10 min the slot frees and they can register.
- The original holder can still resume their own pending within and after the window (if a slot is free).
- Resuming into a now-full tournament → CAPACITY_FULL (422).

H4 — Detail page blocks retry: pending_payment shows as "Registered". tournaments/[id]/page.tsx:214 sets isRegistered from .in("status", ["pending_payment","confirmed"]), and TournamentDetail.tsx:359 renders a disabled "Registered" button when true. A user mid-payment or after a failed payment is shown "Registered" and cannot reach the register/retry flow — even though checkout/route.ts explicitly allows resuming pending_payment/failed_payment. Only confirmed should show "Registered"; pending_payment → "Complete payment"; failed_payment / none / cancelled_payment → "Register". (Found during webhook testing.)

FIXED: page.tsx now fetches the registration status (maybeSingle) instead of a pending/confirmed count and passes registrationStatus to TournamentDetail, whose CTA branches: confirmed → disabled "Registered"; pending_payment → "Complete Payment" link; failed_payment/cancelled/none → "Register Now". Starting-rank visibility was also tightened to confirmed-only (isConfirmed). Tests: TournamentDetail.test.tsx, page.test.ts.

Verification

- Apply migration 009 to Supabase (manual, as with 001–008; functions are
  CREATE OR REPLACE).
- Manual:
  - (a) confirmed user → detail shows disabled "Registered";
  - (b) pending_payment user → "Complete Payment" → pays → confirmed;
  - (c) fail a payment, return, pick a different tier, pay → CHIP and the payment row show the new tier's amount (H1), no 500 (H2).

H5 — Player-facing fee total doesn't match the amount charged. RegisterForm.tsx:15 hardcodes PROCESSING_FEE_CENTS = 150, so the UI shows e.g. RM36 + RM1.50 = RM37.50, while create_registration_with_payment (003_functions_triggers.sql:284-287) computes gross = entry + FLOOR(entry\*commission_rate/100) - organizer_absorbed = RM39.60 (what CHIP actually charges). The hardcoded fee ignores commission_rate / organizer_commission_pct. Distinct from M1 (getMinFeeCents). Planned fix: expose the server-computed gross_amount_cents to the client so the displayed total equals the charge. (Found during webhook testing.)

FIXED: The fee math is no longer in the client. computeEntryFeeBreakdown (src/services/payments/fees.ts) mirrors the SQL formula; register/page.tsx reads the tournament's commission_rate/organizer_commission_pct (server-only) and passes a per-tier feeBreakdown to RegisterForm, which renders the real processing fee + total via formatRmExact (sen precision — formatRm rounds to whole RM). PROCESSING_FEE_CENTS removed. Parity tests: fees.test.ts; display test in RegisterForm.test.tsx. NOTE: the formula now lives in both SQL (charge) and TS (display) — kept in sync by the parity tests + a cross-reference comment; a single-source SQL function is deferred.

Verification

- Client shows correct total fee

Medium

M1 — getMinFeeCents mishandles fees (TournamentCard.tsx:24-29). Math.min(standard, ...additional): a free base (0) with paid extra tiers shows "Free" wrongly; an undefined additional amount yields NaN price.

FIXED: getMinFeeCents is now a single shared helper in utils.ts that collects only finite numeric amounts (standard + additional) and returns their min (0 → "Free" when none). Fixes the NaN case (non-finite additional amounts are ignored) and the phantom-"Free" case (a missing standard no longer injects 0 — the cheapest real tier wins); a genuine 0 still shows "Free". Duplicate copies in TournamentCard.tsx and TournamentDetail.tsx removed. Tests: utils.test.ts.

M2 — Discovery date timezone mismatch. page.tsx builds today in UTC (toISOString()), but TournamentsClient.tsx parses dates in local time. In UTC+8, between midnight and 08:00 an event starting "today" is mis-bucketed as upcoming.

FIXED: page.tsx now computes today via getTodayInTimeZone() (utils.ts), the venue/platform timezone (Asia/Kuala_Lumpur), so buckets use the correct calendar date regardless of server timezone. The client parses today and event dates with the same convention, so bucketing is viewer-independent and SSR-safe. The helper takes a timezone arg for the planned ASEAN per-tournament-tz model (see memory project_asean_timezone). Tests: utils.test.ts.

Verification:

- Manual: with server clock set so UTC date ≠ MYT date (e.g. 01:00 MYT), a tournament whose start_date is today (MYT) appears under Ongoing/Upcoming correctly, not shifted a day. Past section shows events ended within ~45 days and no longer jumps at month rollover.

M3 — Capacity pre-check is TOCTOU (checkout/route.ts:95-106) — mitigated by the row-locking trigger, so no overbooking, but the JS pre-check is redundant/misleading.

FIXED (checkout): the redundant JS pre-check was removed during the H3 work; capacity is enforced only by the Postgres row-lock (trigger + reset assert). The one remaining copy lives in the dead /registrations endpoint (see L1).

Low / hardening

- L1 Two divergent registration endpoints (/registrations vs /checkout); /registrations looks dead.
- L2 tournaments INSERT RLS doesn't re-check org approval_status (API does; defense-in-depth only).
- L3 Past-tournament cutoff is by calendar month — abrupt at month rollover.

FIXED: now a rolling 30-day window (TournamentsClient.tsx); older tournaments will be reachable via a future archive search.

- L4 Malformed dates silently drop tournaments from all buckets.

FIXED: bucketing guards invalid dates with a console.warn + skip (non-silent); defensive since publish validates dates.

Full report written to the plan file. The single highest-leverage fix is C1 (the webhook) — C2/H2/H3 all stem from its absence.
