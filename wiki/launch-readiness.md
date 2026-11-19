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
organizer payouts and platform-distributed prizes (both built, unverified on staging), and any refund
*not* triggered by a cancellation — a player or organizer cannot request one (#509, #510). Players
and organizers can now see where a refund stands (#511), and the player is emailed when it lands or
fails (#512). **Communications** now cover registration confirmation, application and OKU results,
cancellations, refunds and payouts, but some of the MVP's "we'll email you" promises are still
absent. And there is **no production error monitoring**.

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
| Production error monitoring / alerting | S6 | ⚠️ code built, account not set up | 🔴 | Sentry SDK is wired in and inert until configured: follow [error-monitoring.md](./error-monitoring.md) §Setup (#125). Uptime monitor still needed (#572). |
| Audit-log PII redaction + privacy-policy alignment | S3, P5 | ⚠️ built, wording not reviewed | 🟡 | Get the `/privacy` wording reviewed (#503). Rows written before redaction go away when staging and production are rebuilt from `db/migrations` (#631). |
| Identity indirection (`auth_user_id`, `can_act_for`) | S7 | ✅ built, not applied | 🟡 | Code landed (#501); migration `009` still needs applying (#161). Follow-on #513. |
| Organizer payout disbursement | O9, P7 | ⚠️ built, unverified on staging | 🟡 | CHIP Send payouts go out automatically 3 days after a tournament ends in its own timezone (#522), or when a platform admin triggers one; organizers can request admin-approved early payouts (#521). |
| Prize disbursement to players | P14, P7 | ⚠️ built, unverified on staging | 🟡 | Opt-in per tournament (#523): sponsors pay the pool in through CHIP Collect, registration opens once it is fully funded, organizers enter winners, admins approve, and CHIP Send pays verified player accounts. Residual return is manual. See [prize-flow.md](./prize-flow.md). Organizer-distributed prizes stay off-platform. |
| Ledger integrity (`payments.fee_tier`, cancelled-state constraint) | S7, P10 | ✅ built, not applied | 🟡 | Lands when staging and production are rebuilt from `db/migrations` (#502, #631). |
| Refund request & processing | P13, O8 | ⚠️ cancellation refunds ✅ (visible to player + organizer, outcome emailed); player/organizer-initiated ❌ | 🟡 | Cancellation refunds are automatic ([refund-flow.md](./refund-flow.md)). Any other refund is still manual via the CHIP dashboard — **define that process** (#509, #510). |
| Participant CSV / Excel export | O8 | ✅ | — | Export CSV / Export Excel on the manage page (#90): name, title, gender, date of birth, nationality, verified OKU, FIDE/MCF IDs and ratings, fee tier, status, registration time. |
| Non-auth transactional emails | S4, O1, O3, P6, P9 | ⚠️ most ship | 🟡 | Registration confirmation (#119), application result (#120), member invite (#121), OKU result (#449), cancellation, refund outcome (#512), payout and nomination emails ship. Still missing: tournament reminders. |
| Player-initiated registration cancellation | P12 | ❌ | 🟡 | Player forfeits; support handles case-by-case. |
| Admin tournaments / transactions / users pages | A4, A5, A6 | ❌ | 🟡 | Use the Supabase dashboard directly. |
| Self-serve correction of set-once fields / account changes | P5 | ❌ | 🟡 | Support-routed; monitor support load. |
| Support-email inconsistency | V1 | ✅ | — | One shared `SUPPORT_EMAIL` in `src/lib/reference/contact.ts`; the email templates hard-code it and a test fails if one names anything else (#618). |
| Member-invite acceptance / resend / expiry | O3 | ✅ | — | Shipped in #121: accept/decline page, 30-day expiry, resend and revoke on the members page. |
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
- **Deletion runbook:** [account-deletion.md](./account-deletion.md). Support deletes the rows and then calls `anonymise_user_audit_logs` in the same transaction, because deleting `users`/`player_profiles` alone leaves full copies in `audit_logs` (S3, #503). Financial audit rows (`payments`, `refunds`, `payouts`, `registrations`) are deliberately left alone under the 7-year obligation. A self-serve deletion flow should call the same function.

### P6. OKU (disability) verification — ⚠️ Partial
- **Entry (player):** `/settings` → `OkuVerificationCard` → tick the health-data consent box → `POST /api/v1/profile/consents` → upload doc (≤5 MB) to the **private** `oku-documents` bucket → `POST /api/v1/profile/oku` sets `oku_status='pending'`.
- **Consent (#451):** the card is health data, held only with its own explicit consent, recorded in the append-only `sensitive_data_consents` log with the statement version from `legal.ts`. The bucket's upload policy and the route both refuse a card without it. **Withdraw** (any state but `none`): `DELETE /api/v1/profile/oku` deletes everything under the player's `users/{id}/` prefix in the bucket (paged and recursive, `removeAllUnder`), resets the status, then records the withdrawal.
- **Entry (admin):** `/admin/oku/[userId]` (signed 300s URL to the doc) → `PATCH /api/v1/admin/oku/[userId]` approve/reject (guarded on `pending`, rejection reason required).
- **Scenarios:** re-upload allowed only in `none`/`rejected`; double-review prevented (404 if already actioned).
- **Notification:** ✅ approve/reject emails the player (`notifyOkuReviewed`, #449): verified, or rejected with the reason and a link back to Settings to re-upload.

### P7. Banking details — ✅ Built (#523)
- **Entry:** `/settings` → `BankingCard` → `PATCH /api/v1/profile/banking`. The bank is chosen from the SWIFT list, and the account number is 5–20 digits, **never returned** (last 4 only). Stored in `player_bank_accounts`: superseded on change, so a change is verified again.
- **Consent (#451):** bank details are held only with the player's financial-data consent: a checkbox on every save, recorded through `POST /api/v1/profile/consents` before the PATCH. `set_player_bank_account` refuses a save without it (`409 CONSENT_REQUIRED`). **Remove bank details** on the card erases them (rows no prize award names are deleted; a row an award names keeps only bank, holder and last 4) and records the withdrawal in the same transaction.
- **Use:** the destination for platform-distributed prizes (P14). Registered with CHIP Send the first time an approved prize needs it, never on save. The card shows the verification state, and a winner without a usable account is emailed to add or fix it.
- **Gaps:** 🟡 not used for refunds (those go back through CHIP Collect to the original payment method).

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
- **Gaps:** amount-mismatch and `chip_transaction_id`-persist failures are **logged for manual ops** with no alerting 🟡 (ties to S6). Expiry has **no scheduled backstop** — lazy-on-read only 🟢 (see S2). Each payment attempt now records the fee tier it was charged under (`payments.fee_tier`, #502), so a tier change between attempts shows in the ledger.

### P11. My Tournaments — ✅ Built
- **Entry:** `/my/tournaments` → `GET /api/v1/me/registrations` (runs a lazy expiry sweep on read). Ongoing/upcoming/past/cancelled with status badges.
- **Bucketing (#619):** Ongoing | Upcoming | Past | Cancelled, matching discovery's sections. A registration is Ongoing from `start_date` through `end_date` *at the venue* (`getTodayInTimeZone(tournament.timezone)`, compared as date strings), and Past once `end_date` has passed there. The page opens on Ongoing when it has entries, else Upcoming. Ongoing sorts by soonest `end_date`, Upcoming by nearest `start_date`, Past by most recent `end_date`. Logic in `src/app/my/tournaments/classify.ts`.
- **Gaps:** ❌ no "Payment History / download receipt" screen (MVP Flow 5) — CHIP emails the receipt instead 🟢.

### P12. Registration cancellation (player-initiated) — ❌ Not built
- MVP lists `POST /player/registrations/:id/cancel`; **no route or action exists**. A player who can't attend simply forfeits their seat (and, today, gets no refund).
- The refund *machinery* now exists and is reusable (`refundChipPurchase` + `settle_refund`, see P13) — what's missing is the request path and the policy behind it. Tracked with P13 in **#509**.
- **Priority:** 🟡. Interim: support handles case-by-case.

### P13. Refund request — ⚠️ Partial (cancellation refunds built; nothing else)
- **Built and wired end-to-end:** when an admin approves a tournament cancellation, `review_tournament_cancellation()` queues one `refunds` row per confirmed+paid registration, the admin route fires `refundChipPurchase()` per player, and `settle_refund()` appends the mirrored `type='refund'` ledger row — synchronously on a terminal CHIP response, or from the `payment.refunded` webhook. Idempotent at three layers; covered by route tests and `db/tests/settle_refund.sql`. Full detail in **[refund-flow.md](./refund-flow.md)**.
- **Visible and communicated:** the player sees the refund's state on `/my` and the organizer sees the tournament's refunds on its manage page (**#511**); the player is emailed once when the refund lands and once if it fails (**#512**). See [refund-flow.md](./refund-flow.md) §Who sees what, §Outcome emails.
- **Still missing:** a player cannot request a refund (**#509**); an organizer cannot refund from the roster (**#510**); and there is no cross-tournament admin list of refunds (owned by the transactions screen, A5). Consequently `refunds.reviewed_by`/`reviewed_at` are still unexercised — cancellation refunds are auto-approved wholesale.
- **Open operational risks** on the shipped path (`related_to` parsing #495, out-of-band CHIP-dashboard refunds #498, monitoring #499). Stuck `pending` refunds now have an admin re-fire and a dashboard alert (#497), and refunds fire from a scheduled sweep rather than the admin's request (#496) — see [refund-flow.md](./refund-flow.md) §Open risks.
- **Priority:** 🟡 — the launch-blocking case (tournament cancelled, players owed money) is handled; the rest is a support-load and trust question.

### P14. Prize claim / winner payout — ⚠️ Built, unverified on staging (#523)
- Only for tournaments whose prizes MY Chess Tour distributes (`prizes.distribution = "platform"`). Publishing one emails every funder a CHIP payment link for their share and holds the tournament unlisted in `pending_funding` until the pool is paid in. The organizer then enters winners, a platform admin approves at `/admin/prizes`, CHIP Send pays the winner's verified `player_bank_accounts` row, and `settle_prize_award` books the `player_prize` row. Full flow: [prize-flow.md](./prize-flow.md).
- **Gaps:** 🟡 returning undistributed funds to sponsors (and the whole pool on cancellation) is a manual ops step. 🟡 CHIP Send behaviour for player recipients still needs a sandbox run.

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
- **Entry:** `/organizations/apply` → `POST /api/v1/organizations/applications` → RPC `create_organization_application`, which creates the `organizations` row (`approval_status='pending'`), its **payout bank account**, its **KYB document** rows and the **Organizer Agreement stamp** in one transaction. Admin reviews at `/admin/applications/[id]` → `PATCH` → RPC `review_organization_application` which, on approve, **atomically inserts the applicant's `owner` membership**.
- **Collected since #518:** SWIFT-coded bank account (`bank_name` derived server-side from `bank_code`, never client-supplied); entity type (`company`/`society`/`individual`) + SSM/ROS registration number; verification documents uploaded browser→`organization-documents` (private bucket, `users/{app_user_id}/org-kyb/`) with the path prefix re-checked server-side and the object's size/type verified via `storage.info()`.
- **Scenarios:** case-insensitive name uniqueness → 409 (from the unique index, so it's race-free); an account already another org's active destination → 409; entity/document mismatch → 400; a failure anywhere rolls the whole application back, so the name stays free for a retry; reject requires a non-empty reason; applicant can poll their own applications.
- **Admin review shows** the account's **last 4 digits only** and one 300-second signed URL per document. No surface returns the full account number.
- **Notification:** ✅ approve/reject emails the applicant and the application's contact address (`notifyApplicationReviewed`, #120); a rejection carries the reason.
- **Gaps:** ❌ A rejected application's name stays taken, so re-applying needs a different name 🟡.

### O2. Organizer dashboard + settings — ✅ Built
- **Entry:** `/my/organizations/[orgId]` → dashboard route. Stats include a **"Pending Payout"** figure computed from the `tournament_payout_summary` view (display only — see O9). Two blocking notices render above the stats: the agreement re-acceptance gate, and a bank-account notice with three states (missing / awaiting verification / rejected).
- **Settings (#518):** `/my/organizations/[orgId]/settings`, gated on `org.manage`. Organization profile (logo, name, description, links, contact) via `PATCH /api/v1/organizations/[orgId]` — until this shipped there was **no way to edit an organization after creation at all**. Payout bank account (masked view + replace) via `GET`/`PUT .../bank-account`, gated on the narrower `bank_account.manage`. Business verification is **read-only**: changing entity type or registration number would invalidate the admin's KYB decision.
- **Gaps:** ❌ nothing moves a bank account out of `pending` until CHIP Send lands (Phase 4, #519) — deliberate, see O9.

### O3. Team / member management — ⚠️ Partial
- **Entry:** members page → `POST /api/v1/organizations/[orgId]/members/invite` (needs `org.invite`). Role change/remove via `PATCH`/`DELETE .../members/[id]` (needs `org.manage`); you cannot change/remove yourself; owner is not assignable here.
- **Invitations (#121):** ✅ inviting creates an `organization_invitations` row and grants nothing. Every invitee, with or without an account, gets `member-invitation.html` linking to `/invitations/[token]`, where they **accept** (signed in as the invited address, which inserts the membership with the offered role) or **decline** (no account needed). A new address signs up the normal way from that page and is brought back to it after verifying (no account is created on their behalf). Invitations **expire after 30 days**, derived from `expires_at`, so no job runs. Inviting the same address again refreshes the link and the 30 days. The members page lists pending (and unanswered expired) invitations with **Resend** and **Revoke**. Only the token's SHA-256 is stored. The email is best-effort; `email_sent: false` tells the inviter to resend. A signed-in user also sees their open invitations at the top of `/my` and can accept or decline there (by id, `POST /api/v1/me/invitations/[id]/accept|decline`; the database checks they are the invited address). Every fresh accept or decline emails the **inviter** (`invitation-accepted.html` / `invitation-declined.html`). DB functions and their test: `create_/accept_/decline_/revoke_organization_invitation` (+ `_by_id` variants) in 003, `db/tests/organization_invitations.sql`.
- **Gaps:** no leave-org 🟢.

### O4. Create tournament (5-step wizard) — ✅ Built
- **Entry:** `/my/organizations/[orgId]/tournaments/create` → `POST .../tournaments`. Owner/admin of an **approved** org. Saved as `draft` with placeholder dates so incomplete drafts persist. Restrictions & fee tiers (early-bird/titled/rating/age; female/OKU tiers) authored here.

### O5. Publish tournament — ✅ Built
- **Entry:** `POST .../tournaments/[id]/publish`. **Only `draft` can publish** (else 409). Full required-field validation (rejects placeholders → 422 with `details[]`). Assigns a unique slug on first publish, stable on re-publish.

### O6. Edit tournament — ✅ Built
- **Entry:** `PATCH .../tournaments/[id]` (owner/admin). Partial field update.
- **What can change, and when (#536):** see [tournament-editing.md](./tournament-editing.md). Drafts and unpaid listings are fully editable, but a published tournament must stay publishable (422). The first paid registration locks fees, prizes, beneficiary, dates, region, format, time control, ratings and eligibility, and makes capacity increase-only. Capacity can never drop below the seats already taken, holds included (#591, `guard_tournament_seats_taken`). Once started, only the description can change. Ended and cancelled tournaments are read-only. Enforced by the route (409 naming the fields), the `guard_tournament_paid_fields` trigger for the paid stage, and the wizard, which disables locked fields. The slug is still not recomputed on rename (deliberately: shared links stay stable).

### O7. Close registration / cancel tournament — ✅ Built
- **Close registration early:** `POST .../tournaments/[id]/close-registration` — stamps `registration_closed_at`, which is also populated on publish (from `registration_deadline`) so the two paths can't drift. Checkout and the public detail page both read it.
- **Cancel:** two-step, because cancelling a published tournament moves money. The organizer files a request via `POST .../tournaments/[id]/cancel` (blocked for ongoing/completed tournaments); a platform admin reviews it at `/admin/cancellations` → `PATCH /api/v1/admin/tournament-cancellations/[id]`. Approve runs `review_tournament_cancellation()`, which flips `tournaments.status='cancelled'` **and** queues a refund per paid registration in one transaction, then the route fires the CHIP refunds and emails every registered player. Approval is refused (409) once an organizer payout has been paid or is being sent, because the refunds would then be unfundable; the money has to be recovered by hand first (#521).
- **Gaps:** none blocking. Refunds are fired by a 5-minute scheduled sweep, off the admin's request (#496). A refund left `pending` can be retried from `/admin/refunds`, and the admin dashboard flags it (#497); the sweep fires each refund once and doesn't retry.

### O8. Participant roster / management — ⚠️ Partial
- **Entry:** tournament manage page → `getTournamentManageData` (roster with statuses, live expiry sweep).
- **Export:** ✅ CSV / Excel download of the roster for seeding pairing software (#90), via `GET …/tournaments/:id/participants/export?format=csv|xlsx`.
- **Gaps:** ❌ no per-row "refund" / "cancel registration" actions (MVP Flow 4) — this would be the first code to actually check the `refund.manage` permission (#510).

### O9. Payout — ⚠️ Built (automatic sweep unverified on staging)
- **Entry:** the `tournament_payout_summary` **view** aggregates the payments ledger into `net_payout_cents`, surfaced as the dashboard "Pending Payout" stat.
- **Since #518** there is a **recipient**: `organization_bank_accounts` holds one active row per org, superseded (never edited) on change so a `verified` stamp can't outlive the details it verified, and unique on `(bank_code, account_number)` among active rows so one account can't be two organizations' payout destination. Row ids are the deterministic CHIP Send `reference`.
- **Since #520** money can actually leave: a platform admin triggers a payout from `/admin/payouts`, it goes out through CHIP Send, and `settle_payout` books the `organizer_payout` ledger row. Organizers follow it at `/my/organizations/[orgId]/payouts`, and may nominate another approved organization as beneficiary. See [payout-flow.md](./payout-flow.md).
- **Since #521** an owner can request up to 50% of net revenue early once registration has closed, at most twice, from the payouts page; a platform admin approves or rejects it at `/admin/payouts/[id]`, which spells out the cap. Admins are emailed when a request is filed and when a payout is parked waiting for CHIP Send budget. A cancellation can no longer be approved once organizer money has left (see O7).
- **Since #522** payouts go out on their own: a daily GitHub Actions job (01:00 UTC) calls `POST /api/v1/cron/payouts`, which pays every tournament 3 days after it ends at its venue (`tournament_end_instant`), retries payouts parked on budget, and settles payouts stuck in `processing` from CHIP's record when a webhook was lost.
- **Gaps:** the sweep hasn't yet been run against staging end to end (seeded ended tournament → send instruction → `paid` → ledger row → "Pending Payout" drains → email, then a re-run). The workflow needs the `CRON_SECRET` and `PRODUCTION_URL` repository secrets, which the FIDE job already uses. Until tournament schedules exist, the end instant is midnight after `end_date`.
- **Priority:** 🟡 — the code path is complete; what's left is the staging run before the first real tournament ends.

---

## 7. Admin flows

Admin = the `platform.manage` global permission. Pages `redirect("/")` and API routes 403 without it.

### A1. Admin dashboard — ✅ Built
- **Entry:** `/admin/dashboard` → aggregate stats (users, orgs by approval, tournaments by status, confirmed registrations, revenue from the payout view, pending orgs, recent tournaments).
- **Gaps:** ❌ no registrations chart (recharts isn't a dependency) — the MVP wants a 30-day bar chart 🟢.

### A2. Organizer application review — ✅ Built
- See **O1**. The applicant is emailed the decision (#120).

### A3. OKU verification review — ✅ Built
- See **P6**. The player is emailed the decision (#449).

### A4. Admin tournament moderation — ⚠️ Partial
- MVP lists an `/admin/tournaments` panel; **no such page exists** (#107, #108) — admins cannot browse or moderate tournaments in-app. Interim: Supabase dashboard. 🟡
- What *does* exist: **`/admin/cancellations`**, where admins review organizer cancellation requests (approve → cancel + refund, or reject with a reason). See O7. And **`/admin/refunds`**, where admins retry refunds stuck in `pending` (#497).

### A5. Admin transactions view — ❌ Not built
- MVP lists `/admin/transactions`; **no route/page exists** (#109, #110). No cross-tournament view of payments **or refunds**: an admin can see one tournament's refunds on its read-only manage page (#511). The exception is refunds stuck in `pending`, which have their own page, `/admin/refunds`, with a retry each and a dashboard banner (#497). Interim: Supabase dashboard. 🟡

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

### S3. Audit logging — ⚠️ Partial (redacted, but unbounded)
- **Built:** `audit_trigger_func` writes to `audit_logs` on inserts/updates/deletes of the sensitive tables, storing full `old_data`/`new_data` jsonb snapshots.
- **Redaction (#516, extended by #518 and #503).** `redact_audit_snapshot` masks the listed columns on the way into the snapshot — enough to answer "did this change?", never enough to reconstruct the value. Covered today: `player_profiles.bank_account_number` and `organization_bank_accounts.account_number` (last 4 digits), and `player_profiles.oku_document_path`, `organization_documents.storage_path` and `.original_filename` (#503; an identity document's filename often carries an IC number). Filenames and paths use their own rule (`redact_jsonb_filenames`): only an accepted extension (png/jpg/jpeg/webp/pdf) survives, because "last 4 characters" of a name with no extension can be the end of an IC number. Regression tests: `db/tests/audit_redaction.sql` and scenario A1 of `db/tests/organizer_onboarding.sql`. **Any new sensitive column must be added to `redact_audit_snapshot()` in the same PR that adds the column.**
- **Deliberately kept in snapshots:** `date_of_birth`, `gender`, `oku_status`, `nationality`, `fide_id`. They are what an eligibility dispute turns on ("I was entered in the wrong age band"), so they are not redacted on the way in. They are removed when the account is deleted instead.
- **Account deletion (#503).** `anonymise_user_audit_logs(user_id)` replaces every key in that user's `users`/`player_profiles` snapshots with `[anonymised]`, except an allowlist of ids and timestamps, and clears `changed_by` on the non-financial rows they wrote. `payments`/`refunds`/`payouts`/`registrations` audit rows are untouched (7-year retention overrides). Called from the [deletion runbook](./account-deletion.md); tests in `db/tests/audit_anonymisation.sql`. `/privacy` and the signup modal list audit records in the retention table.
- **Pre-redaction rows (#503).** A database built from the current migrations has none. Staging and production may still hold rows written before each column was redacted, including every uploaded filename, until they are rebuilt from `db/migrations` (#631). The rebuild removes them, so no scrub is needed.
- **To review 🟢.** `payouts.chip_receipt_url` is copied into audit snapshots. Check whether the CHIP Send receipt page shows the recipient's bank details to anyone with the link. Only org admins and platform admins can read those rows.
- **Gap — retention 🟢 (#507).** No retention policy and no pruning. `FOR EACH ROW` on INSERT/UPDATE/DELETE across nine tables with two snapshots each means this will be the largest table by row count long before `payments` is. Not urgent (no volume yet), but it needs `prune_audit_logs` with dry-run + batched deletes, an index on `(table_name, created_at)`, and a schedule — which needs `pg_cron`, the **same missing prerequisite as S2**. Land them together.

### S4. Transactional email — ⚠️ Partial
- Provider Resend (`src/services/email/email.ts`), templates in `templates/` (a test checks each is complete). Beyond auth (`sendVerificationEmail`, `sendPasswordResetEmail`) it sends: registration confirmation (#119, once per confirmation via `settle_registration_payment`'s `newly_confirmed`), organizer application result (#120), member invitation and the inviter's accepted/declined notice (#121), OKU result (#449), tournament cancellation and cancellation review, bank verification, payout sent/failed/early-request review, admin payout alerts, payout nomination plus the nominee's accept/decline (#562), and refund completed/failed (#512, once per outcome via `settle_refund`'s `newly_settled`/`newly_failed`). Fan-out is best-effort and never fails the action (`services/email/recipients.ts`). The change-email, reauthentication, magic-link and invite-user templates are Supabase-dashboard copies, **not wired to app code** (member invites no longer go through Supabase's invite email at all).
- **Gaps:** ❌ tournament reminders. See the **Communications** gap in §9. 🟡

### S5. Notifications (in-app / SMS / push) — ❌ Not built
- No `notifications` table or service, no SMS, no web-push. 🟢

### S6. Observability (error monitoring / analytics) — ⚠️ Partial (Sentry code built, not switched on)
- **Sentry is wired in (#125)** but sends nothing until `NEXT_PUBLIC_SENTRY_DSN` is set. It covers thrown server errors (`onRequestError`), every handled `console.error` (`captureConsoleIntegration`), so P10's "logged for manual ops" reconciliations and failed refund settlements (#499) now surface, plus uncaught browser errors and the root error boundary. The remaining work is account and Netlify setup: [error-monitoring.md](./error-monitoring.md) §Setup, including a privacy-policy addition that needs review.
- **Gaps:** no uptime monitor (#572); no analytics (Plausible/Umami), which is 🟢.
- **Priority:** 🔴 (operational) — complete the Sentry setup + add an uptime check before launch.

### S7. Schema groundwork (identity indirection + ledger integrity) — ❌ Not built
Not a user flow — two schema items whose cost depends on *when* they're done, which is why they sit
on the pre-launch list despite being invisible to users. Neither changes behaviour.

- **Identity indirection — ✅ Built, not yet applied (#501).** `users.auth_user_id` is now the only link to Supabase Auth; `app_user_id()` resolves a JWT `sub` to a `users.id` and **every** RLS policy and storage policy goes through it (`auth.uid()` appears nowhere else). `can_act_for()` is in place as a seam — currently the bare self check, used by the `player_profiles` / `registrations` / `payments` / `refunds` policies so P15 changes one function body instead of sweeping every policy again. `users`, `user_global_roles`, `organization_memberships`, and the own-account `audit_logs` policy deliberately do **not** use it and are commented as such at each site. App side: `AuthIdentity.id` is now the `users.id` (with `authUserId` alongside for Supabase Auth calls), so the ~59 call sites that read `claims.id` became correct without individual edits; `lookupAppUserId` (`src/services/supabase/identity.ts`) is the single bridge. **One route needed a separate fix:** `tournaments/[slug]/checkout` authenticates with `getUser()` rather than `getAuthClaims()` — the deliberate exception from #363, kept for an immediate revocation check before taking money — so it never appeared in a `claims.id` sweep and was still passing the raw auth id into `player_profiles`, `registrations`, and `create_registration_with_payment`. It now resolves through `lookupAppUserId` and fails closed (401) on an unlinked session. A full re-audit of every identity source and every `user_id` / `p_user_id` argument confirms it was the only one. Because `handle_new_user` writes `auth_user_id = id` for self-signup, **nothing changes behaviour** — verified by the full suite (1519 green) and `db/tests/identity_indirection.sql`, which uses deliberately divergent ids so a policy still comparing `auth.uid()` fails loudly.
  - **Hardening found while reviewing this:** `users` had a blanket client UPDATE policy with no column restriction, so anyone holding a user's JWT could `PATCH /rest/v1/users` to null their own `auth_user_id` (orphaning the record permanently) or set `is_verified: true` (skipping the emailed code — a pre-existing hole, unrelated to #501). No application code needed the policy: every `users` write goes through the service-role client. Client UPDATE/INSERT/DELETE is now revoked outright, with `guard_users_identity_columns` as a trigger-level backstop on `id`/`auth_user_id`. See [roles-and-permissions.md](./roles-and-permissions.md).
  - **Test-suite guard:** `src/test/setup.ts` now stubs the identity lookup so the auth and app id spaces **differ across the whole suite** (`appIdFor`). Previously they matched, which is exactly why a route passing a raw auth id was indistinguishable from a correct one and survived a full sweep — reintroducing the checkout bug now fails ordinary route tests, not just bespoke ones.
  - **Outstanding:** the schema has not been applied to any environment (ties to #161), and the query-plan check the issue asked for (`app_user_id()` is `STABLE`, but confirm no regression on `/my/tournaments` and checkout) needs a live database. The array-shaped checkout response — #501 part 3 — was split out to **#513** as speculative and, unlike the rest, no more expensive later.
- **Ledger integrity — ✅ Built, not yet applied (#502).** (a) Each payment row records the fee tier it was charged under (`payments.fee_tier`), written by `create_registration_with_payment` and `start_new_payment_attempt`. `registrations.fee_tier` is now plainly the tier of the current attempt, and counting tiers ("how many juniors paid") should read the ledger. Rows written before the column exist keep `NULL` rather than a guessed backfill. (b) `chk_cancelled_fields_consistent` requires `cancelled_at` exactly when a registration is `cancelled_payment` or `forfeited`, so each new path that cancels (P12, refunds, cart expiry) fails loudly if it forgets the timestamp or a revival forgets to clear it. `failed_payment` is retryable, so it is outside the constraint.
  - **Outstanding:** lands when staging and production are rebuilt from `db/migrations` (#631), with no separate rollout.

---

## 9. Cross-cutting gaps (prioritized)

1. **Money-out — 🔴/🟡.** Organizer payouts (O9, #375) and prize disbursement (P14) are unbuilt and captured banking (P7) is unused — those remain 🔴 and manual. Refunds are **no longer blocked**: the cancellation path moves money automatically (P13), leaving 🟡 gaps for player/organizer-initiated refunds (#509, #510). *Interim for payouts/prizes:* manual disbursement + a tracking sheet, but **define and record the process** before taking real money.
2. **Observability — 🔴 (operational).** Sentry is built but not switched on (S6). Until the [setup](./error-monitoring.md#setup) is done, a failed asynchronous refund settlement is still silent (#499). *Interim:* none — finish the Sentry setup + add an uptime check before launch.
3. **Data protection — 🟡 (compliance).** Sensitive columns are redacted on the way into `audit_logs` (#516/#518/#503), account deletion anonymises the user's audit history ([runbook](./account-deletion.md)), and `/privacy` now lists audit records in its retention table (S3, #503). Left: run the pre-redaction check against staging and production, and have a second person review the retention wording. Retention/pruning (#507) is the 🟢 follow-on.
4. **Cheap-now, expensive-later schema — 🟡.** Identity indirection (#501) and ledger integrity (#502) are both **built** while there is still little data to migrate. Left: apply them to staging and production (S7).
5. **Communications — 🟡.** Registration confirmation, application/OKU results, member invite, cancellation and payout emails exist (S4). Still missing: reminders.
6. **Organizer event-running tooling — ✅.** Participant CSV/Excel export ships (O8, #90), so rosters can seed pairing software.
7. **Admin tooling — 🟡.** No admin tournaments/transactions/users pages (A4–A6); `/admin/cancellations` is the one operational admin screen beyond applications/OKU. *Interim:* Supabase dashboard.
8. **Support-load risks — 🟡.** Set-once profile fields with no self-serve correction, and no self-serve email/name change or account deletion (P5). These convert small user mistakes into support tickets. Deletion is support-run through [account-deletion.md](./account-deletion.md) until a self-serve flow exists, and P16 would make the missing correction path more visible.
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
- [x] **[S3]** Publish an audit-log row in the `/privacy` retention table, and anonymise audit history on account deletion (#503).
- [ ] **[S3]** Get the retention wording reviewed by a second person before it ships — it amends a published compliance commitment.
- [x] **[S7]** Identity indirection (#501) — landed pre-launch, so the sweep never had to touch live payment records.
- [ ] **[S7]** Rebuild staging and production from `db/migrations` (#631, see [database-migrations.md](./database-migrations.md); ties to #161). This also lands #502's ledger columns and clears #503's pre-redaction audit rows. Then run `db/tests/identity_indirection.sql` and check the query plans on `/my/tournaments` and checkout for regression from the `app_user_id()` lookup. 🔴
- [x] **[S7]** Add `payments.fee_tier` and the `cancelled_at` consistency constraint (#502).
- [ ] **[P15–P17]** Confirm the team is happy deferring dependents, claiming, and carts — and that one-checkout-per-player is acceptable for the first events. 🟢

**Visitor**
- [x] **[V1]** Fix the support-email inconsistency (`mychesstour@gmail.com` → `support@mychesstour.com`) (#618).
- [ ] **[V1]** Decide whether the waitlist needs a confirmation email.
- [ ] **[V2/V3]** Verify browse, filters, full-badge, and detail render for a published tournament.

**Player — account & profile**
- [ ] **[P1–P4]** Smoke-test signup → verify → login → logout → password reset end to end (real Resend delivery).
- [ ] **[P1]** Confirm the Resend-down rollback (no half-provisioned account blocks retry).
- [ ] **[P5]** Decide on a correction path for mistyped set-once fields (admin tool vs support).
- [ ] **[P6]** Decide whether OKU approve/reject needs an email (else players wait blind).
- [x] **[P7]** Decide when/where banking details get collected from actual prize winners. Settings, prompted by the prize-awarded email; verified the first time a prize needs it (#523).

**Player — participation**
- [ ] **[P8]** Verify eligibility gates: wrong gender/age/nationality/title, unverified OKU tier, missing FIDE/MCF id.
- [ ] **[P9/P10]** Run the CHIP end-to-end manual scenarios in [payment-flow.md](./payment-flow.md) §C (happy, decline→retry, cancel, abandon+resume, expiry, webhook race).
- [ ] **[P10]** Decide how amount-mismatch / persist-failure reconciliations get surfaced (ties to S6).
- [ ] **[P11]** Verify My Tournaments listing + lazy expiry.

**Organizer**
- [ ] **[O1]** Test apply → admin approve → owner membership appears; decide on the approval email.
- [ ] **[O4/O5]** Test the create wizard → publish (validation + slug) happy path.
- [x] **[O6]** Decide whether editing a *published* tournament (dates/fees) after registrations is allowed. Decided in #536, see [tournament-editing.md](./tournament-editing.md).
- [ ] **[O7]** Test cancel end to end: organizer files → admin approves → tournament `cancelled`, players emailed, refunds settle. Then re-run approve to confirm it's idempotent.
- [x] **[O8]** Provide participant export (CSV/Excel) or a documented workaround for pairing. Built in #90.
- [ ] **[O3]** Confirm invite → accept (existing user, and a new address via signup), decline, revoke and resend on staging.

**Admin**
- [ ] **[A1]** Verify dashboard stats load and match reality.
- [ ] **[A2/A3]** Test application and OKU review (approve/reject with reason).
- [ ] **[A4/A5/A6]** Confirm the team is comfortable using the Supabase dashboard for tournament moderation, transactions, and user management until those pages exist.

**System**
- [ ] **[S1]** Trigger the FIDE cron manually (`workflow_dispatch`) once against production; confirm counts.
- [ ] **[S2/S3]** Accept lazy expiry for launch, or stand up `pg_cron` — which also unblocks audit-log pruning (#507); do both at once if you do either.
- [ ] **[S3]** Measure actual `audit_logs` growth against the Supabase plan's storage ceiling and record the real figure (#507).
- [ ] **[S4]** Confirm only the four wired emails (verification, password reset, tournament cancellation, cancellation review) are expected to send at launch.
