# MY Chess Tour — Launch Readiness: User & Process Flows

> Pre-launch review of **every** user and process flow in the platform: its entry point, happy
> path, alternate/error scenarios, whether it is **built / partial / not built**, and the gaps
> to close (or consciously defer) before going live. Written for developers, AI agents, and
> product — read it alongside the deep-dives it links to: [payment-flow.md](./payment-flow.md),
> [authentication-flow.md](./authentication-flow.md), [chip-webhook.md](./chip-webhook.md), and
> the original intent in [mvp.md](./mvp.md) §"User Flows & Wireframes".
>
> **Snapshot:** 2026-07-29 · app `0.8.1-alpha` (refund/cancellation rows refreshed; the rest is
> from the original 2026-07-06 · `0.6.1-alpha` pass). The public site is still a "Coming Soon"
> waitlist; the full app is built behind it. This doc reflects the code at that snapshot —
> re-verify the ❌/⚠️ items before acting on them, they are the ones most likely to change.

## Table of Contents

1. [How to use this doc](#1-how-to-use-this-doc)
2. [Launch-readiness summary](#2-launch-readiness-summary)
3. [Visitor / public flows](#3-visitor--public-flows)
4. [Player — account & profile](#4-player--account--profile)
5. [Player — tournament participation](#5-player--tournament-participation)
6. [Organizer flows](#6-organizer-flows)
7. [Admin flows](#7-admin-flows)
8. [System / background processes](#8-system--background-processes)
9. [Cross-cutting gaps (prioritized)](#9-cross-cutting-gaps-prioritized)
10. [Pre-launch review checklist](#10-pre-launch-review-checklist)

---

## 1. How to use this doc

Each flow is tagged with an implementation **status** and each gap with a **launch priority**.

**Status**

| Badge | Meaning |
|---|---|
| ✅ Built | Implemented and reachable; happy path works. |
| ⚠️ Partial | Core exists but a meaningful piece is missing or unwired. |
| ❌ Not built | Envisioned (usually in [mvp.md](./mvp.md)) but no code path exists. |

**Launch priority** (a *recommendation* to anchor discussion — the final call is the team's)

| Badge | Meaning |
|---|---|
| 🔴 Blocker | Should be resolved (built **or** a defined manual process) before taking real money/users. |
| 🟡 Nice-to-have | Launch is possible without it, but it will hurt UX or ops noticeably. |
| 🟢 Post-launch | Safe to defer. |

**Per-flow template:** *Entry point → Happy path → Scenarios (alternate/error) → Status → Gaps.*
Payment and auth internals are **summarized here and linked** to their deep-dive docs rather than
duplicated.

> **Review item #0 — launch gating.** There is **no global waitlist gate**. `src/proxy.ts` only
> auth-protects `/admin`, `/my`, `/organizations/`, `/settings`. `/tournaments` and `/auth/*` are
> already reachable by anyone, even though the landing page and metadata say "Coming Soon". Decide
> whether the app should stay behind the waitlist until launch, or open now. Everything below
> assumes the app *is* live.

---

## 2. Launch-readiness summary

**Verdict:** the **participate-and-pay-in** loop is the strong core — browse → register → pay via
CHIP → confirm is built and genuinely well-tested (route tests + a DB money-state suite; see
[payment-flow.md](./payment-flow.md) §Regression testing). Auth, progressive profiling, the
organizer application→publish→manage path, and platform admin review (applications, OKU) are all
built.

**Money-out has opened, but only along one path.** Cancelling a published tournament is built
(organizer requests → admin approves) and approval now **refunds every paid player through CHIP**,
end-to-end and tested — see [refund-flow.md](./refund-flow.md). What is still schema/view only:
organizer payouts and prize disbursement (captured bank details are never read), and any refund
*not* triggered by a cancellation — a player or organizer cannot request one (#509, #510), and no
screen anywhere shows a refund's status (#511). **Communications** have started too (cancellation
emails ship), but most of the MVP's "we'll email you" promises are still absent — including telling
the player their refund actually landed (#512). And there is **no production error monitoring**.

**Two non-feature items also belong on the pre-launch list.** `audit_logs` is accumulating
**unredacted PII** — bank account numbers, DOB, OKU status, and the path to the uploaded OKU
document — which the published `/privacy` retention table does not cover, so the platform is
currently out of step with a commitment it made itself (#503). The **identity indirection** that
sat next to it (`users.auth_user_id` + `app_user_id()` + `can_act_for()`) is now **built** (#501) —
no behaviour change, but `users.id` is finally decoupled from `auth.uid()`, which is what keeps the
deferred P15–P17 cluster cheap. Its migration still has to be applied (#161).

### Gap table

Ordered by priority. "Flow(s)" reference the IDs used in §3–§8.

| Feature | Flow(s) | Status | Priority | Interim option |
|---|---|---|---|---|
| Production error monitoring / alerting | S6 | ❌ | 🔴 | Add Sentry (or similar) + an uptime monitor before taking real money. |
| Audit-log PII redaction + privacy-policy alignment | S3, P5 | ❌ | 🔴 | None — redaction can't be applied retroactively, and every day of traffic writes more (#503). |
| Identity indirection (`auth_user_id`, `can_act_for`) | S7 | ✅ built, not applied | 🟡 | Code landed (#501); migration `009` still needs applying (#161). Follow-on #513. |
| Organizer payout disbursement | O9, P7 | ⚠️ view only | 🔴 | Manual bank transfer + record it. Nothing is *due* until the first tournament ends — but define it now. |
| Prize disbursement to players | P14, P7 | ❌ | 🟡 | Manual; same timing/mechanism as payouts. |
| Ledger integrity (`payments.fee_tier`, cancelled-state constraint) | S7, P10 | ❌ | 🟡 | Reconstruct a tier change from `audit_logs` by hand if a dispute arises (#502). |
| Refund request & processing | P13, O8 | ⚠️ cancellation refunds ✅; player/organizer-initiated ❌ | 🟡 | Cancellation refunds are automatic ([refund-flow.md](./refund-flow.md)). Any other refund is still manual via the CHIP dashboard — **define that process** (#509, #510, #511, #512). |
| Participant CSV / Excel export | O8 | ❌ | 🟡 | Transcribe from the roster; needed for pairing software (Swiss-Manager etc.). |
| Non-auth transactional emails | S4, O1, P6, P9 | ⚠️ auth + cancellation only | 🟡 | Cancellation emails ship; CHIP's receipt covers payments. Still missing: registration confirmation (#119), application result (#120), OKU result (#449), refund outcome (#512). |
| Player-initiated registration cancellation | P12 | ❌ | 🟡 | Player forfeits; support handles case-by-case. |
| Admin tournaments / transactions / users pages | A4, A5, A6 | ❌ | 🟡 | Use the Supabase dashboard directly. |
| Self-serve correction of set-once fields / account changes | P5 | ❌ | 🟡 | Support-routed; monitor support load. |
| Support-email inconsistency | V1 | ⚠️ | 🟡 | One-line fix (`mychesstour@gmail.com` → `support@mychesstour.com`). |
| Member-invite acceptance / resend / expiry | O3 | ❌ | 🟢 | Direct insert already works; re-invite manually. |
| Payment-expiry scheduled backstop | S2 | ⚠️ lazy-on-read | 🟢 | Lazy sweep + CHIP `due` suffice; add `pg_cron` later (shared prerequisite with #507). |
| Dependent accounts (register on behalf of others) | P15 | ❌ | 🟢 | Each player needs their own account (#504). |
| Account claiming (dependent takes ownership) | P16 | ❌ | 🟢 | N/A until dependents exist (#505). |
| Multi-participant checkout (one payment, N seats) | P17 | ❌ | 🟢 | One checkout per player — three kids means three FPX redirects (#506). |
| Audit-log retention & pruning | S3 | ❌ | 🟢 | No volume yet; write the policy down before the table is big enough to make pruning risky (#507). |
| In-app notifications / SMS / push | S5 | ❌ | 🟢 | Not needed for launch. |
| Payment history / receipts screen | P11 | ❌ | 🟢 | CHIP emails the receipt. |
| OAuth / magic-link login | P2 | ❌ | 🟢 | Email + password works. |
| Dashboard charts | A1 | ❌ | 🟢 | Stats are shown as numbers. |

**Closed since the 2026-07-06 pass:** *Cancel / close a published tournament* (O7, A4) — was 🔴
"no cancel action anywhere". Now built end-to-end, and approving a cancellation refunds every paid
player automatically, which is what dropped *Refund request & processing* from 🔴 to 🟡.

---

## 3. Visitor / public flows

### V1. Waitlist signup — ⚠️ Partial
- **Entry:** `/` landing (`src/app/page.tsx`) → `src/components/WaitlistForm.tsx` → server action `src/app/_actions/joinWaitlist.ts` → `waitlist` table.
- **Happy path:** enter email + pick `user_type` (player/organizer) → insert → form swaps to "You're on the list. We'll be in touch."
- **Scenarios:** empty email → blocked client-side (`required`) and server-side; **duplicate** email → Postgres unique-violation (`23505`) is swallowed as an idempotent success (no error shown); other DB error → generic message citing support.
- **Gaps:** ❌ **no confirmation/welcome email** despite "we'll be in touch" copy — a submitter has no proof it worked beyond the UI swap, and the address is never validated. Support-email **inconsistency**: this flow cites `mychesstour@gmail.com`, the rest of the app cites `support@mychesstour.com` 🟡.

### V2. Browse & discover tournaments — ✅ Built
- **Entry:** `/tournaments` (`src/app/tournaments/`) → `GET /api/v1/tournaments` (returns `status='published'` only); live spot counts via RPC `get_participant_counts`.
- **Scenarios:** full tournaments show a "Full" badge/disabled state; filters by format/state/rating/date.

### V3. View tournament details — ✅ Built
- **Entry:** `/tournaments/[slug]`. Fee tiers, prizes, eligibility, capacity, deadline; "Register" CTA.

---

## 4. Player — account & profile

Auth flows (P1–P4) are summarized; see **[authentication-flow.md](./authentication-flow.md)** for
session/token internals. Note the app uses a **custom email-verification code** flow (Redis +
Resend), not Supabase's built-in confirmation link, and **email/password only** (no OAuth/magic-link).

### P1. Signup — ✅ Built
- **Entry:** `/auth/signup`. Three endpoints under `/api/v1/auth/signup/`: `create-account` → `verify-code` → `request-code` (resend).
- **Happy path:** submit name/email/password → account created with a 6-char code emailed via Resend → enter code (15-min TTL) → verified → routed to `/tournaments`. Profile details come later (progressive).
- **Scenarios:** per-IP rate-limit (429); existing email (409); code expiry (410); brute-force guard on verify (429); resend is enumeration-safe (always generic 200); the verify step is URL-gated by a `SIGNUP_STEP_COOKIE`. **Rollback:** if code storage/email fails, both `public.users` and `auth.users` are deleted so a retry isn't blocked.
- **Gaps:** hard dependency on Resend — if it's down, signup fully rolls back (can't create an account).

### P2. Login — ✅ Built
- **Entry:** `/auth/login` → `_actions/login.ts`. Redis lockout **5 attempts / 15 min** per email. "Keep me signed in" toggles session-only cookies (see [authentication-flow.md](./authentication-flow.md) §10).
- **Scenarios:** correct password on an **unverified** account → local sign-out + resend code + carried into the verify step (not dead-ended); redirect sanitized (defaults `/tournaments`).
- **Gaps:** 🟢 no OAuth/magic-link.

### P3. Logout — ✅ Built
- **Entry:** `/auth/logout` → `signOut({ scope: 'local' })` — **this device only**; there is no logout-everywhere option.

### P4. Password reset — ✅ Built
- **Entry:** `/auth/forgot-password` → Resend recovery link → `/api/v1/auth/callback` (`verifyOtp`) → `/auth/update-password` (guarded: requires a recovery session via the JWT `amr`). Enumeration-safe (always returns success). On update, all sessions are signed out.

### P5. Profile / progressive profiling — ✅ Built
- **Entry:** `/settings` (`_components/ProfileClient.tsx`) → `PATCH /api/v1/profile`. The `player_profiles` row is auto-created empty at signup by the `handle_new_user` trigger, so profiling is genuinely just-in-time.
- **Happy path:** fill avatar (≤2 MB → public `avatars` bucket), DOB, gender, nationality, FIDE ID, MCF ID as needed.
- **Scenarios:** DOB/gender/nationality/`fide_id`/`mcf_id` are **set-once** (enforced server *and* client); `title`/`national_rating` are never user-editable (come from FIDE). First time `fide_id` is set, ratings/title backfill from FIDE; a nonexistent ID is rejected (400); if FIDE is unreachable the ID is saved and the monthly cron backfills later (see S1).
- **Gaps:** 🟡 **no self-serve correction** for a mistyped set-once field, and **no self-serve email/name change or account deletion** — all routed to support. Expect support load; consider an admin correction tool.
- **Note for whoever builds deletion:** anonymising `users`/`player_profiles` is **cosmetic unless it also scrubs `audit_logs`**, which holds full pre-anonymisation snapshots (S3, #503). Financial audit rows (`payments`, `refunds`, `registrations`) are deliberately exempt under the 7-year obligation. Wire this into the runbook now, while the process is still manual.

### P6. OKU (disability) verification — ⚠️ Partial
- **Entry (player):** `/settings` → `OkuVerificationCard` → upload doc (≤5 MB) to the **private** `oku-documents` bucket → `POST /api/v1/profile/oku` sets `oku_status='pending'`.
- **Entry (admin):** `/admin/oku/[userId]` (signed 300s URL to the doc) → `PATCH /api/v1/admin/oku/[userId]` approve/reject (guarded on `pending`, rejection reason required).
- **Scenarios:** re-upload allowed only in `none`/`rejected`; double-review prevented (404 if already actioned).
- **Gaps:** ❌ **no notification to the player** on approve/reject — the pending card says "we'll update your status" but the player only learns the outcome by revisiting Settings. This blocks OKU-tier registration (see P8) with no ETA 🟡.

### P7. Banking details — ⚠️ Partial (captured, unused)
- **Entry:** `/settings` → `BankingCard` → `PATCH /api/v1/profile/banking`. Account number 5–20 digits, freely editable, **never returned** (last-4 only). Purpose per UI: "pay out prize winnings and process refunds."
- **Gaps:** ❌ **nothing consumes this** — there is no disbursement path (see P14/O9), no just-in-time prompt forcing a prize winner to add it, and no account verification. `BankingForm` is explicitly scaffolded for a "future" prize-claim/refund surface that does not exist.

---

## 5. Player — tournament participation

### P8. Eligibility check — ✅ Built
- **Two layers.** Server (authoritative, at checkout) in `.../tournaments/[slug]/registrations/validators.ts`: `checkRestrictions` (gender/nationality/title/rating/**age as of the tournament start date**), `checkFeeTierEligibility` (female-only, **verified-OKU-only**, titled, age bands), `checkRatedRequirements` (FIDE/MCF id present). Client mirror in `RegisterForm.tsx` → inline `CompleteProfilePrompt` that PATCHes the profile and re-runs eligibility **without leaving checkout**.
- **Key distinction:** a **null** field is "collectable" (fixable inline); a **mismatch** is a hard block.
- **Gaps:** logic is intentionally duplicated (server authoritative) — keep the two in sync. OKU eligibility depends on P6, which has no notification.

### P9. Registration + checkout — ✅ Built
- **Entry:** `/tournaments/[slug]/register` → `POST /api/v1/tournaments/[slug]/checkout` — the **single** register-and-pay entry point (there is no separate registration POST). RPC `create_registration_with_payment` atomically creates the registration + first payment row; capacity is enforced by a Postgres trigger.
- **States:** `pending_payment` → `confirmed` | `failed_payment` | `cancelled_payment`. (`forfeited` exists in the enum but **is never set by any code**.)
- **Scenarios:** already confirmed → 409; concurrent double-submit (`23505`) → re-read the winner and resume; **zero-fee tier** bypasses CHIP and confirms directly; deadline passed → 422; capacity full → 422.
- See **[payment-flow.md](./payment-flow.md)** for the money mechanics.

### P10. Payment (CHIP) — ✅ Built + tested
- **Summary:** initiate a CHIP purchase (`due = now + 10 min`) → settle via signed webhook `POST /api/v1/webhooks/chip` (RSA-SHA256 verify) → the browser-return pages reconcile through the same RPC (`resolvePaymentState`) so a late/missing webhook can't strand a payment → resume/retry reuses or supersedes the attempt → expiry is app-owned and time-based. Guarantee: **"real money wins"** — a late `paid` rescues a row previously marked failed/expired.
- **Full happy path, scenario matrix, and the regression-test layers live in [payment-flow.md](./payment-flow.md).** Do not re-derive them here.
- **Gaps:** amount-mismatch and `chip_transaction_id`-persist failures are **logged for manual ops** with no alerting 🟡 (ties to S6). Expiry has **no scheduled backstop** — lazy-on-read only 🟢 (see S2). The ledger also records what was charged but **not which fee tier it was charged under**, so a tier change between attempts is unexplained in the payment history 🟡 (see S7, #502).

### P11. My Tournaments — ✅ Built
- **Entry:** `/my/tournaments` → `GET /api/v1/me/registrations` (runs a lazy expiry sweep on read). Upcoming/past/cancelled with status badges.
- **Gaps:** ❌ no "Payment History / download receipt" screen (MVP Flow 5) — CHIP emails the receipt instead 🟢.

### P12. Registration cancellation (player-initiated) — ❌ Not built
- MVP lists `POST /player/registrations/:id/cancel`; **no route or action exists**. A player who can't attend simply forfeits their seat (and, today, gets no refund).
- The refund *machinery* now exists and is reusable (`refundChipPurchase` + `settle_refund`, see P13) — what's missing is the request path and the policy behind it. Tracked with P13 in **#509**.
- **Priority:** 🟡. Interim: support handles case-by-case.

### P13. Refund request — ⚠️ Partial (cancellation refunds built; nothing else)
- **Built and wired end-to-end:** when an admin approves a tournament cancellation, `review_tournament_cancellation()` queues one `refunds` row per confirmed+paid registration, the admin route fires `refundChipPurchase()` per player, and `settle_refund()` appends the mirrored `type='refund'` ledger row — synchronously on a terminal CHIP response, or from the `payment.refunded` webhook. Idempotent at three layers; covered by route tests and `db/tests/settle_refund.sql`. Full detail in **[refund-flow.md](./refund-flow.md)**.
- **Still missing:** a player cannot request a refund (**#509**); an organizer cannot refund from the roster (**#510**); `refunds.status` has **no read surface at all** outside the Supabase dashboard (**#511**); and no email tells the player the refund actually landed or failed (**#512**). Consequently `refunds.reviewed_by`/`reviewed_at` and the per-refund RLS policies are still unexercised — cancellation refunds are auto-approved wholesale.
- **Open operational risks** on the shipped path (`related_to` parsing #495, inline fan-out timeout #496, no re-fire for stuck `pending` #497, out-of-band CHIP-dashboard refunds #498, monitoring #499) — see [refund-flow.md](./refund-flow.md) §Open risks.
- **Priority:** 🟡 — the launch-blocking case (tournament cancelled, players owed money) is handled; the rest is a support-load and trust question.

### P14. Prize claim / winner payout — ❌ Not built
- No prize disbursement anywhere; captured banking details (P7) are never read; no `player_prize` payment row is ever created by code.
- **Priority:** 🟡 (money owed to players; timing is post-event). Interim: manual, alongside organizer payouts (O9).

> **P15–P17 are a deliberately deferred cluster**, not oversights. They share one prerequisite —
> the identity indirection in S7 (#501) — which is why that item is 🔴 while these are 🟢: doing the
> groundwork before launch is what keeps them cheap additions rather than migrations across live
> payment records. Sequenced #504 → #505 → #506, ascending in risk.

### P15. Dependent accounts (register on behalf of others) — ❌ Not built (deferred)
- A guardian, coach, or carer cannot register a child, ward, student, or assisted OKU player. Every participant needs their own email and their own account. `guardianships`, `users.account_type`, and `registrations.registered_by` do not exist.
- **Blocked on** `users.auth_user_id` + `can_act_for()` (S7, #501) — with those in place this is additive: a table, one function body, and a participant picker at checkout.
- **Decision embedded here:** `payments.user_id` must mean the **payer** (guardian), while `registrations.user_id` means the **participant** (dependent). They are identical today, which is exactly why the distinction has to be settled before they diverge — getting it backwards would hand a claimant someone else's payment history (see P16).
- **Priority:** 🟢 post-launch (#504). Interim: one account per player.

### P16. Account claiming (dependent takes ownership) — ❌ Not built (deferred)
- A child who grows up, or an adult dependent set up by a coach, cannot take over their own record while keeping registrations, profile, FIDE sync, and public profile URL.
- Cheap *if* #501 shipped: `users.id` never changes, so the transfer is one row plus a `guardianships` status flip, with **no RLS change**. The work is the flow, not the update.
- **Key constraint:** claim-**first** only. Merging two independently-created player identities after the fact is a genuine reconciliation (conflicting set-once fields, possibly two seats in the same tournament against `UNIQUE (user_id, tournament_id)`) with no correct automatic answer — detect and route to support instead.
- **Priority:** 🟢 post-launch (#505), after P15.

### P17. Multi-participant checkout (one payment, N seats) — ❌ Not built (deferred)
- One CHIP purchase cannot cover several registrations. With P15 shipped, three children means three separate FPX redirects.
- **The expensive one.** `payments` currently does three jobs in one row — the CHIP purchase, the attempt state machine, and the per-registration line item. Splitting purchase/attempt out into `checkout_attempts` makes the webhook, supersede, expiry, and late-`paid` rescue paths **set-based**, and that is the highest-risk code in the system. `db/tests/settle_registration_payment.sql` — the only safety net on the money path — needs rewriting scenario by scenario.
- **Prerequisite decision:** a cart must be scoped to **one tournament**. Spanning tournaments means one settlement paying multiple organizers, which turns this into a payout-system rewrite.
- **Deliberately unstarted:** nothing done today makes it cheaper, so it waits for a real guardian or organizer to ask. **Priority:** 🟢 (#506).

---

## 6. Organizer flows

RBAC is data-driven (roles `owner`/`admin`/`member` + permission keys), not enums. Gates via
`has_org_permission` / `has_global_permission` (see [authentication-flow.md](./authentication-flow.md) §7).

### O1. Apply as organizer → approval — ✅ Built
- **Entry:** `/organizations/apply` → `POST /api/v1/organizations/applications` (creates `organizations` row, `approval_status='pending'`). Admin reviews at `/admin/applications/[id]` → `PATCH` → RPC `review_organization_application` which, on approve, **atomically inserts the applicant's `owner` membership**.
- **Scenarios:** case-insensitive name uniqueness → 409; reject requires a non-empty reason; applicant can poll their own applications.
- **Gaps:** ❌ **no email on approve/reject** — the MVP says approval "triggers an email notification"; today the applicant must poll 🟡.

### O2. Organizer dashboard — ✅ Built
- **Entry:** `/my/organizations/[orgId]` → dashboard route. Stats include a **"Pending Payout"** figure computed from the `tournament_payout_summary` view (display only — see O9).

### O3. Team / member management — ⚠️ Partial
- **Entry:** members page → `POST /api/v1/organizations/[orgId]/members/invite`. Existing user → membership inserted directly (active); new user → Supabase `inviteUserByEmail` + pending membership. Role change/remove via `PATCH`/`DELETE .../members/[id]` (needs `org.manage`); you cannot change/remove yourself; owner is not assignable here.
- **Gaps:** ❌ **no acceptance workflow, no resend, no expiry** for pending invites (the MVP shows a "Resend" affordance); no leave-org 🟢.

### O4. Create tournament (5-step wizard) — ✅ Built
- **Entry:** `/my/organizations/[orgId]/tournaments/create` → `POST .../tournaments`. Owner/admin of an **approved** org. Saved as `draft` with placeholder dates so incomplete drafts persist. Restrictions & fee tiers (early-bird/titled/rating/age; female/OKU tiers) authored here.

### O5. Publish tournament — ✅ Built
- **Entry:** `POST .../tournaments/[id]/publish`. **Only `draft` can publish** (else 409). Full required-field validation (rejects placeholders → 422 with `details[]`). Assigns a unique slug on first publish, stable on re-publish.

### O6. Edit tournament — ✅ Built (with caveat)
- **Entry:** `PATCH .../tournaments/[id]` (owner/admin). Partial field update.
- **Caveat / review item:** editing is **not restricted to drafts** — a **published** tournament can be edited (dates, fees, restrictions) with no status guard, and the slug is not recomputed on rename. Confirm this is intended once players have already registered/paid 🟡 (data-integrity review).

### O7. Close registration / cancel tournament — ✅ Built
- **Close registration early:** `POST .../tournaments/[id]/close-registration` — stamps `registration_closed_at`, which is also populated on publish (from `registration_deadline`) so the two paths can't drift. Checkout and the public detail page both read it.
- **Cancel:** two-step, because cancelling a published tournament moves money. The organizer files a request via `POST .../tournaments/[id]/cancel` (blocked for ongoing/completed tournaments); a platform admin reviews it at `/admin/cancellations` → `PATCH /api/v1/admin/tournament-cancellations/[id]`. Approve runs `review_tournament_cancellation()`, which flips `tournaments.status='cancelled'` **and** queues a refund per paid registration in one transaction, then the route fires the CHIP refunds and emails every registered player.
- **Gaps:** none blocking. The refund fan-out runs inline in the admin request (#496) and there is no re-fire for a refund left `pending` (#497).

### O8. Participant roster / management — ⚠️ Partial
- **Entry:** tournament manage page → `getTournamentManageData` (roster with statuses, live expiry sweep).
- **Gaps:** ❌ **no CSV/Excel export** (MVP Flow 4) — organizers need participant lists to seed pairing software 🟡 (#90); ❌ no per-row "refund" / "cancel registration" actions (MVP Flow 4) — this would be the first code to actually check the `refund.manage` permission (#510).

### O9. Payout — ⚠️ Partial (view/display only)
- **Entry:** the `tournament_payout_summary` **view** aggregates the payments ledger into `net_payout_cents`, surfaced as the dashboard "Pending Payout" stat.
- **Gaps:** ❌ **no `/my/organizations/[orgId]/payouts` page** (MVP Flow 5 — the directory doesn't exist); ❌ **no disbursement** — no payout route, no `organizer_payout`/`player_prize` rows are ever *created* by code, no CHIP payout call, no status machine. The organizer sees an amount owed; the actual money movement is manual, out-of-band, and unrecorded.
- **Priority:** 🔴 — nothing is *due* until the first tournament ends, but the process (even if manual) must be defined and recorded before launch.

---

## 7. Admin flows

Admin = the `platform.manage` global permission. Pages `redirect("/")` and API routes 403 without it.

### A1. Admin dashboard — ✅ Built
- **Entry:** `/admin/dashboard` → aggregate stats (users, orgs by approval, tournaments by status, confirmed registrations, revenue from the payout view, pending orgs, recent tournaments).
- **Gaps:** ❌ no registrations chart (recharts isn't a dependency) — the MVP wants a 30-day bar chart 🟢.

### A2. Organizer application review — ✅ Built
- See **O1**. Gap: ❌ no applicant email on decision 🟡.

### A3. OKU verification review — ✅ Built
- See **P6**. Gap: ❌ no player notification on decision 🟡.

### A4. Admin tournament moderation — ⚠️ Partial
- MVP lists an `/admin/tournaments` panel; **no such page exists** (#107, #108) — admins cannot browse or moderate tournaments in-app. Interim: Supabase dashboard. 🟡
- What *does* exist: **`/admin/cancellations`**, where admins review organizer cancellation requests (approve → cancel + refund, or reject with a reason). See O7.

### A5. Admin transactions view — ❌ Not built
- MVP lists `/admin/transactions`; **no route/page exists** (#109, #110). No in-app view of payments **or refunds** — a refund stuck in `pending` is invisible without querying the DB (#511, and #499 for metrics). Interim: Supabase dashboard. 🟡

### A6. Admin users management — ❌ Not built
- MVP sidebar lists "Users"; **no page exists**. 🟢

---

## 8. System / background processes

### S1. FIDE ratings sync — ✅ Built
- **Two paths sharing one code path** (so they can't drift): **on-save** when a player sets/edits their `fide_id` (profile PATCH), and a **monthly cron** — GitHub Actions `.github/workflows/fide-ratings.yml` (2nd of each month) → `POST /api/v1/cron/fide-ratings` (bearer `CRON_SECRET`), paging all players with a `fide_id`.
- **Mechanism:** FIDE has no API, so `src/services/fide/fide.ts` **scrapes the HTML profile** and parses ratings/title with lenient name-matching.
- **Gaps:** the scrape is brittle — a FIDE markup change silently breaks sync; worth monitoring 🟡. (This is the **only** scheduled job; `tests.yml`/`claude.yml` are CI, not crons.)

### S2. Payment-expiry sweep — ⚠️ Partial (lazy, no schedule)
- `expire_stale_pending_payments` runs **on read** in three paths (return-page resolver, organizer roster, `GET /me/registrations`). Capacity self-frees after 10 min and the CHIP `due` makes stale links unpayable, so impact is low; but a `pending_payment` row never read again is never terminalized.
- **Gaps:** 🟢 no `pg_cron` backstop (there is no scheduler in the Netlify/`next start` deploy). The unscoped RPC call already exists for when one is added. **Audit-log pruning (S3, #507) needs the same scheduler** — standing `pg_cron` up once covers both, so sequence them together.

### S3. Audit logging — ⚠️ Partial (built, but unredacted and unbounded)
- **Built:** `audit_trigger_func` writes to `audit_logs` on inserts/updates/deletes of the sensitive tables, storing full `old_data`/`new_data` jsonb snapshots.
- **Gap — PII 🔴 (#503).** Because the trigger captures the *whole row*, every `users` / `player_profiles` audit entry carries a verbatim copy of **bank account number, DOB, gender, OKU status, and `oku_document_path`** (which grants signed-URL access to a private-bucket medical document). Two consequences: (a) the `/privacy` retention table doesn't list `audit_logs` at all, so an anonymisation request would leave complete pre-anonymisation copies behind — a breach of a **published** commitment; (b) the same page's encryption-at-rest claim needs qualifying, since these are plain jsonb. **Redaction cannot be applied retroactively** — every day of traffic writes more rows, which is why the fix is cheapest now. The deletion path must also scrub audit logs, while deliberately *not* touching `payments`/`refunds`/`registrations` rows (7-year retention overrides). Ties to the missing self-serve deletion in P5.
- **Gap — retention 🟢 (#507).** No retention policy and no pruning. `FOR EACH ROW` on INSERT/UPDATE/DELETE across nine tables with two snapshots each means this will be the largest table by row count long before `payments` is. Not urgent (no volume yet), but it needs `prune_audit_logs` with dry-run + batched deletes, an index on `(table_name, created_at)`, and a schedule — which needs `pg_cron`, the **same missing prerequisite as S2**. Land them together.

### S4. Transactional email — ⚠️ Partial (auth + cancellation)
- Provider Resend (`src/services/email/email.ts`) exports **four** senders: `sendVerificationEmail`, `sendPasswordResetEmail`, `sendTournamentCancellationEmail` (all registered players), and `sendCancellationReviewEmail` (organizer, approved/rejected). Templates for the last two live alongside them in `templates/`. The remaining template files (change-email, reauthentication, magic-link, invite) are Supabase-dashboard copies, **not wired to app code**.
- **Gaps:** ❌ registration/payment confirmation (#119), application result (#120), member invite (#121), OKU result (#449), tournament reminders, and **refund outcome** (#512) — the cancellation email promises a refund and nothing ever confirms it landed. See the **Communications** gap in §9. 🟡

### S5. Notifications (in-app / SMS / push) — ❌ Not built
- No `notifications` table or service, no SMS, no web-push. 🟢

### S6. Observability (error monitoring / analytics) — ❌ Not built
- No Sentry, no Plausible/Umami — nothing in dependencies or code. For a launch that handles money, **error monitoring + alerting is operationally important** (it's also where P10's "logged for manual ops" reconciliations would surface).
- **Priority:** 🔴 (operational) — add basic error monitoring + an uptime check before launch.

### S7. Schema groundwork (identity indirection + ledger integrity) — ❌ Not built
Not a user flow — two schema items whose cost depends on *when* they're done, which is why they sit
on the pre-launch list despite being invisible to users. Neither changes behaviour.

- **Identity indirection — ✅ Built, not yet applied (#501).** `users.auth_user_id` is now the only link to Supabase Auth; `app_user_id()` resolves a JWT `sub` to a `users.id` and **every** RLS policy and storage policy goes through it (`auth.uid()` appears nowhere else). `can_act_for()` is in place as a seam — currently the bare self check, used by the `player_profiles` / `registrations` / `payments` / `refunds` policies so P15 changes one function body instead of sweeping every policy again. `users`, `user_global_roles`, `organization_memberships`, and the own-account `audit_logs` policy deliberately do **not** use it and are commented as such at each site. App side: `AuthIdentity.id` is now the `users.id` (with `authUserId` alongside for Supabase Auth calls), so the ~59 call sites that read `claims.id` became correct without individual edits; `lookupAppUserId` (`src/services/supabase/identity.ts`) is the single bridge. Because `handle_new_user` writes `auth_user_id = id` for self-signup, **nothing changes behaviour** — verified by the full suite (1519 green) and `db/tests/identity_indirection.sql`, which uses deliberately divergent ids so a policy still comparing `auth.uid()` fails loudly.
  - **Outstanding:** the schema has not been applied to any environment (ties to #161), and the query-plan check the issue asked for (`app_user_id()` is `STABLE`, but confirm no regression on `/my/tournaments` and checkout) needs a live database. The array-shaped checkout response — #501 part 3 — was split out to **#513** as speculative and, unlike the rest, no more expensive later.
- **Ledger integrity — 🟡 (#502).** Two gaps that exist *today*, independent of the deferred cluster. (a) `payments` records the pricing **output** but not the **input** — the fee tier lives on the mutable `registrations.fee_tier`, which reflects only the current attempt. If a corrected DOB or a completed OKU verification moves a player between tiers mid-retry, the ledger shows two attempts at different amounts with nothing recording why; `start_new_payment_attempt` already receives `p_fee_tier` and simply doesn't persist it on the immutable row. (b) Nothing forces `cancelled_at` to be set when a registration goes terminal or cleared when a late `paid` rescues it — that pairing is convention inside two functions today, and the number of paths that terminalize a registration is about to grow (P12, refunds, cart expiry).

---

## 9. Cross-cutting gaps (prioritized)

1. **Money-out — 🔴/🟡.** Organizer payouts (O9, #375) and prize disbursement (P14) are unbuilt and captured banking (P7) is unused — those remain 🔴 and manual. Refunds are **no longer blocked**: the cancellation path moves money automatically (P13), leaving 🟡 gaps for player/organizer-initiated refunds (#509, #510) and refund visibility (#511). *Interim for payouts/prizes:* manual disbursement + a tracking sheet, but **define and record the process** before taking real money.
2. **Observability — 🔴 (operational).** No error monitoring/alerting (S6) for a money-handling app. *Interim:* none — add Sentry + uptime before launch. Now doubly relevant: refunds settle asynchronously and a failed one is currently silent (#499).
3. **Data protection — 🔴 (compliance).** `audit_logs` stores unredacted bank numbers, DOB, OKU status, and OKU document paths, and `/privacy` publishes a retention table that doesn't mention the table at all (S3, #503). *Interim:* none that helps — redaction can't reach rows already written, so the volume of the problem grows daily. Retention/pruning (#507) is the 🟢 follow-on.
4. **Cheap-now, expensive-later schema — 🟡.** Identity indirection (#501) is **done** — the sweep landed while it was still small. Ledger integrity (#502) remains: two real gaps in the money trail that get worse once there are payments to reconstruct (S7). *Interim:* none — that's the point of the priority.
5. **Communications — 🟡.** Auth + cancellation emails exist (S4); most MVP-promised emails don't. *Interim:* rely on the CHIP receipt for payments; manually email organizers on approval and players on OKU decisions. Recommend at least registration-confirmation, application/OKU-result, and refund-outcome (#512) emails.
6. **Organizer event-running tooling — 🟡.** No participant CSV/Excel export (O8, #90) — core to actually running an event (pairing software). Recommend for launch.
7. **Admin tooling — 🟡.** No admin tournaments/transactions/users pages (A4–A6); `/admin/cancellations` is the one operational admin screen beyond applications/OKU. *Interim:* Supabase dashboard.
8. **Support-load risks — 🟡.** Set-once profile fields with no self-serve correction, and no self-serve email/name change or account deletion (P5); support-email inconsistency (V1, a trivial fix). These convert small user mistakes into support tickets. Account deletion is also a prerequisite for the audit-log scrub in #503, and P16 would make the missing correction path more visible.
9. **Auth niceties — 🟢.** No OAuth/magic-link (email+password is fine); no logout-everywhere.
10. **Deferred platform capabilities — 🟢.** Dependent accounts (P15, #504), account claiming (P16, #505), and multi-participant checkout (P17, #506). Sequenced and costed; unstarted on purpose. *Interim:* one account and one checkout per player — ship it that way and let real demand decide.

> The 🔴/🟡/🟢 tags are the one place this doc reflects **judgment, not code fact**. Treat them as a
> starting proposal and adjust to the actual launch plan (e.g. if the first event is free/small,
> money-out priorities shift).

---

## 10. Pre-launch review checklist

Grouped by actor; each item is a decision to make, a happy path to test, or a gap to close.
Flow IDs in brackets point back to the detail above.

**Gating & cross-cutting**
- [ ] **[#0]** Decide launch gating — keep the app behind the waitlist, or open `/tournaments` + `/auth/*`? (`src/proxy.ts`)
- [ ] **[S6]** Stand up error monitoring + an uptime check. 🔴
- [ ] **[P13]** Run one **real CHIP sandbox refund** end to end and confirm both response shapes and the `related_to` webhook payload against [refund-flow.md](./refund-flow.md) §Open risks 1–2. 🔴 (the whole path is modelled from docs, not observed traffic)
- [ ] **[P13]** Decide the **non-cancellation** refund policy — window, full vs partial, who approves — before #509/#510 get built. 🟡
- [ ] **[O9/P14]** Define how organizer payouts and player prizes are disbursed and recorded. 🔴
- [ ] **[S3]** Redact `bank_account_number` and `oku_document_path` from audit snapshots, scrub the rows already written, and publish an audit-log row in the `/privacy` retention table (#503). 🔴 — *the only item here that gets strictly worse with every day of delay*
- [ ] **[S3]** Get the retention wording reviewed by a second person before it ships — it amends a published compliance commitment.
- [x] **[S7]** Identity indirection (#501) — landed pre-launch, so the sweep never had to touch live payment records.
- [ ] **[S7]** Apply `db/migrations/001`–`007` (ties to #161), then run `db/tests/identity_indirection.sql` and check the query plans on `/my/tournaments` and checkout for regression from the `app_user_id()` lookup. 🔴
- [ ] **[S7]** Add `payments.fee_tier` and the `cancelled_at` consistency constraint (#502) — verify no existing row violates the constraint on staging *and* production first. 🟡
- [ ] **[P15–P17]** Confirm the team is happy deferring dependents, claiming, and carts — and that one-checkout-per-player is acceptable for the first events. 🟢

**Visitor**
- [ ] **[V1]** Fix the support-email inconsistency (`mychesstour@gmail.com` → `support@mychesstour.com`).
- [ ] **[V1]** Decide whether the waitlist needs a confirmation email.
- [ ] **[V2/V3]** Verify browse, filters, full-badge, and detail render for a published tournament.

**Player — account & profile**
- [ ] **[P1–P4]** Smoke-test signup → verify → login → logout → password reset end to end (real Resend delivery).
- [ ] **[P1]** Confirm the Resend-down rollback (no half-provisioned account blocks retry).
- [ ] **[P5]** Decide on a correction path for mistyped set-once fields (admin tool vs support).
- [ ] **[P6]** Decide whether OKU approve/reject needs an email (else players wait blind).
- [ ] **[P7]** Decide when/where banking details get collected from actual prize winners.

**Player — participation**
- [ ] **[P8]** Verify eligibility gates: wrong gender/age/nationality/title, unverified OKU tier, missing FIDE/MCF id.
- [ ] **[P9/P10]** Run the CHIP end-to-end manual scenarios in [payment-flow.md](./payment-flow.md) §C (happy, decline→retry, cancel, abandon+resume, expiry, webhook race).
- [ ] **[P10]** Decide how amount-mismatch / persist-failure reconciliations get surfaced (ties to S6).
- [ ] **[P11]** Verify My Tournaments listing + lazy expiry.

**Organizer**
- [ ] **[O1]** Test apply → admin approve → owner membership appears; decide on the approval email.
- [ ] **[O4/O5]** Test the create wizard → publish (validation + slug) happy path.
- [ ] **[O6]** Decide whether editing a *published* tournament (dates/fees) after registrations is allowed.
- [ ] **[O7]** Test cancel end to end: organizer files → admin approves → tournament `cancelled`, players emailed, refunds settle. Then re-run approve to confirm it's idempotent.
- [ ] **[O8]** Provide participant export (CSV/Excel) or a documented workaround for pairing.
- [ ] **[O3]** Confirm invite (existing + new user) works; accept that resend/expiry are absent.

**Admin**
- [ ] **[A1]** Verify dashboard stats load and match reality.
- [ ] **[A2/A3]** Test application and OKU review (approve/reject with reason).
- [ ] **[A4/A5/A6]** Confirm the team is comfortable using the Supabase dashboard for tournament moderation, transactions, and user management until those pages exist.

**System**
- [ ] **[S1]** Trigger the FIDE cron manually (`workflow_dispatch`) once against production; confirm counts.
- [ ] **[S2/S3]** Accept lazy expiry for launch, or stand up `pg_cron` — which also unblocks audit-log pruning (#507); do both at once if you do either.
- [ ] **[S3]** Measure actual `audit_logs` growth against the Supabase plan's storage ceiling and record the real figure (#507).
- [ ] **[S4]** Confirm only the four wired emails (verification, password reset, tournament cancellation, cancellation review) are expected to send at launch.
