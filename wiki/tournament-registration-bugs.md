Critical

C1 — No CHIP payment webhook exists. There's no *webhook*/*chip* route under src/app/api. Payments are created pending and registrations pending_payment, and nothing ever flips them to paid/confirmed. The RLS comment in 004_rls.sql even assumes webhooks that don't exist. No registration can ever reach confirmed — the paid flow is non-functional.

Update (testing): The webhook (src/app/api/v1/webhooks/chip/route.ts) and migration 008 (settle_registration_payment) are now in place. Two blockers were found during testing and fixed:
1. Localhost callback — NEXT_PUBLIC_SITE_URL was http://localhost:3000 (in .env.local and .env.staging), which CHIP cannot reach, so the callback never arrived. Test on a publicly reachable URL (Netlify/tunnel). Also fix .env.staging NEXT_PUBLIC_SITE_URL (still localhost).
2. Wrong reference field — chip.ts created purchases with reference_id, but CHIP's Purchase object uses reference (reference_id is ignored), so the purchase.paid payload carried no reference and the handler logged "missing reference_id" and skipped the update. Fixed: chip.ts now sends reference, and the webhook correlates on the CHIP purchase id (payload.id == payments.chip_transaction_id, always set after checkout) with reference as fallback. NOTE: purchases created before this fix have no stored reference but are still correlatable by chip_transaction_id.

Separately, failure events require a CHIP dashboard webhook subscribed to purchase.payment_failure pointed at /api/v1/webhooks/chip; success_callback fires on success only.

C2 — Success page lies about payment. register/success/page.tsx is static, keyed only on tournament id. It unconditionally says "Payment Successful. Your registration is now active" without reading any record or checking CHIP. Anyone can hit the URL directly; users whose payment failed still see success.

High

H1 — Resume-payment ignores the newly chosen fee tier (checkout/route.ts:236-237). For an existing pending_payment/failed_payment registration it resumes with existing.id and discards the new fee_tier from the request — the user is re-charged the original amount even if they picked a cheaper tier.

H2 — failed_payment resume is broken (checkout/route.ts:280-285). initiateChipPayment fetches the payment with .eq("status","pending").single(). A failed payment isn't pending, so .single() errors → 500 "Payment record not found." (Latent today only because nothing sets failed_payment yet — see C1.)

H3 — Pending registrations consume capacity forever. Capacity counts pending_payment + confirmed (checkout/route.ts:95-106 + the check_tournament_capacity trigger), and there's no expiry/cleanup. With no webhook (C1), every abandoned checkout permanently eats a slot; tournaments fill with ghosts and become un-registerable.

H4 — Detail page blocks retry: pending_payment shows as "Registered". tournaments/[id]/page.tsx:214 sets isRegistered from .in("status", ["pending_payment","confirmed"]), and TournamentDetail.tsx:359 renders a disabled "Registered" button when true. A user mid-payment or after a failed payment is shown "Registered" and cannot reach the register/retry flow — even though checkout/route.ts explicitly allows resuming pending_payment/failed_payment. Only confirmed should show "Registered"; pending_payment → "Complete payment"; failed_payment / none / cancelled_payment → "Register". (Found during webhook testing.)

H5 — Player-facing fee total doesn't match the amount charged. RegisterForm.tsx:15 hardcodes PROCESSING_FEE_CENTS = 150, so the UI shows e.g. RM36 + RM1.50 = RM37.50, while create_registration_with_payment (003_functions_triggers.sql:284-287) computes gross = entry + FLOOR(entry*commission_rate/100) - organizer_absorbed = RM39.60 (what CHIP actually charges). The hardcoded fee ignores commission_rate / organizer_commission_pct. Distinct from M1 (getMinFeeCents). Planned fix: expose the server-computed gross_amount_cents to the client so the displayed total equals the charge. (Found during webhook testing.)

Medium

M1 — getMinFeeCents mishandles fees (TournamentCard.tsx:24-29). Math.min(standard, ...additional): a free base (0) with paid extra tiers shows "Free" wrongly; an undefined additional amount yields NaN price.

M2 — Discovery date timezone mismatch. page.tsx builds today in UTC (toISOString()), but TournamentsClient.tsx parses dates in local time. In UTC+8, between midnight and 08:00 an event starting "today" is mis-bucketed as upcoming.

M3 — Capacity pre-check is TOCTOU (checkout/route.ts:95-106) — mitigated by the row-locking trigger, so no overbooking, but the JS pre-check is redundant/misleading.

Low / hardening

- L1 Two divergent registration endpoints (/registrations vs /checkout); /registrations looks dead.
- L2 tournaments INSERT RLS doesn't re-check org approval_status (API does; defense-in-depth only).
- L3 Past-tournament cutoff is by calendar month — abrupt at month rollover.
- L4 Malformed dates silently drop tournaments from all buckets.

Full report written to the plan file. The single highest-leverage fix is C1 (the webhook) — C2/H2/H3 all stem from its absence.
