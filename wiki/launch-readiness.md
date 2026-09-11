# MY Chess Tour — Launch Readiness: User & Process Flows

> Pre-launch review of **every** user and process flow in the platform: its entry point, happy
> path, alternate/error scenarios, whether it is **built / partial / not built**, and the gaps
> to close (or consciously defer) before going live. Written for developers, AI agents, and
> product — read it alongside the deep-dives it links to: [payment-flow.md](./payment-flow.md),
> [authentication-flow.md](./authentication-flow.md), [chip-webhook.md](./chip-webhook.md), and
> the original intent in [mvp.md](./mvp.md) §"User Flows & Wireframes".
>
> **Snapshot:** 2026-09-11 · `staging` @ `0655600` · app `0.8.1-alpha` (payout Phases 1–2, the
> per-tournament venue timezone, and the draft/fee-tier fixes folded in; rows not touched by those
> carry forward from the 2026-07-29 and 2026-07-06 passes). The public site is still a "Coming
> Soon" waitlist; the full app is built behind it. This doc reflects the code at that snapshot —
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

**Money-out still leaves the platform along one path only — but it now has a sequenced plan and
its foundations have landed.** Cancelling a published tournament is built (organizer requests →
admin approves) and approval **refunds every paid player through CHIP**, end-to-end and tested —
see [refund-flow.md](./refund-flow.md). The payout epic (**#515**) breaks organizer disbursement
into eight phases, of which **Phase 1 — data-integrity foundations (#516)** and **Phase 2 — legal
(#517)** are merged. Phase 1 redacted bank numbers and OKU document paths out of audit snapshots,
dropped the dead (and anon-readable) bank columns on `organizations`, added a per-tournament venue
country, froze tournament edits in two stages, and made every priced prize declare an external
funding source. Phase 2 turned the Terms and the new **Organizer Agreement** into versioned
documents whose acceptance is persisted per user and per organization. Everything that actually
*moves* money out is still unbuilt: organizer bank details + KYB (#518), the CHIP Send client and
bank verification (#519), the payouts table and executor (#520), early payouts (#521), the
automatic cron (#522), and the platform-managed prize pool (#523). Beyond payouts, any refund *not*
triggered by a cancellation is still missing — a player or organizer cannot request one (#509,
#510), and no screen anywhere shows a refund's status (#511). **Communications** have started
(cancellation emails ship), but most of the MVP's "we'll email you" promises are still absent —
including telling the player their refund actually landed (#512). And there is **no production
error monitoring** (#125).

**Two structural decisions now live in the code and need confirmation from outside it.** First,
entry fees are treated as an **administration fee** and prizes must be **externally funded** —
`validatePrizeFunding` blocks publish on any priced prize category or special prize that does not
name a sponsor, grant, or the organizer's own funds, and `entry_fees` is deliberately not a
selectable source. That is a design decision taken on Shariah reasoning (see #515), **not a
ruling**, and it should be confirmed with a qualified advisor before launch; if the answer differs,
what changes is publish validation and Phase 8, not the payout math. Second, the Organizer
Agreement's fifteen clauses are written and wired, but the **wording has not been reviewed by
anyone qualified** — and it is the document that makes the payout claw-back enforceable.

**Two non-feature items still belong on the pre-launch list, one of them now much smaller.**
The `audit_logs` PII problem (#503) is **mostly closed**: `redact_jsonb_columns` masks
`bank_account_number` and `oku_document_path` to a last-4 on the way in, the `/privacy` encryption
claim has been corrected to what is actually true, and KYB documents are disclosed ahead of Phase 3
collecting them. What remains is the published **retention table still not listing `audit_logs`**
and the deletion-path scrub (`anonymise_user_audit_logs`) not existing — 🟡 now rather than 🔴,
because new snapshots are redacted from here on and the schema has never been applied to production
(#161), so there are no live unredacted rows to chase. The **identity indirection**
(`users.auth_user_id` + `app_user_id()` + `can_act_for()`) is **built** (#501) — no behaviour
change, but `users.id` is finally decoupled from `auth.uid()`, which is what keeps the deferred
P15–P17 cluster cheap. Its migration, too, still has to be applied (#161).

### Gap table

Ordered by priority. "Flow(s)" reference the IDs used in §3–§8.

| Feature | Flow(s) | Status | Priority | Interim option |
|---|---|---|---|---|
| Production error monitoring / alerting | S6 | ❌ | 🔴 | Add Sentry (or similar) + an uptime monitor before taking real money (#125). |
| Organizer payout disbursement | O9, P7 | ⚠️ view only; Phases 1–2 of 8 merged | 🔴 | Manual bank transfer + record it. Nothing is *due* until the first tournament ends — but the plan is now #515 → #518–#523, and the CHIP Send vendor setup has **external lead time**, so start it before the code. |
| Organizer bank details + KYB collection | O1, O9 | ❌ (Phase 3) | 🔴 | #518. The dead `organizations` bank columns were dropped in Phase 1; the replacement is an RLS-gated table that does not exist yet, so there is no verified recipient to pay. |
| CHIP Send client + bank-account verification | O9 | ❌ (Phase 4) | 🔴 | #519, #374. `.env.staging` already carries `CHIP_SEND_API_KEY`/`SECRET`, referenced nowhere. Vendor account-manager setup is a prerequisite, not a code task. |
| Organizer Agreement wording review | O1, O2 | ⚠️ written, unreviewed | 🔴 | The machinery is live (#517); the clauses need a qualified legal review before they are relied on — it is what makes the claw-back enforceable. |
| Prize-funding rule confirmation (Shariah) | O4, O5, P14 | ✅ enforced in code, unconfirmed | 🔴 | Publish already rejects a priced prize with no external source. Confirm the reasoning with a qualified advisor (#515); a different answer changes publish validation and Phase 8 only. |
| Platform-distributed prize pools are selectable but unbuilt | P14, O4 | ❌ | 🔴 | The wizard offers "MY Chess Tour distributes the prizes" and publish accepts it; nothing collects or pays a pool (Phase 8, #523). Disable the option or reject it at publish. |
| Audit-log deletion scrub + retention-table row | S3, P5 | ⚠️ redaction ✅ | 🟡 | Write-time redaction landed (#516). Still open in #503: `audit_logs` is absent from the published `/privacy` retention table, and `anonymise_user_audit_logs()` doesn't exist. |
| Identity indirection (`auth_user_id`, `can_act_for`) | S7 | ✅ built, not applied | 🟡 | Code landed (#501); the schema still needs applying (#161). Follow-on #513. |
| Ledger integrity (`payments.fee_tier`, cancelled-state constraint) | S7, P10 | ❌ | 🟡 | Reconstruct a tier change from `audit_logs` by hand if a dispute arises (#502). |
| Refund request & processing | P13, O8 | ⚠️ cancellation refunds ✅; player/organizer-initiated ❌ | 🟡 | Cancellation refunds are automatic ([refund-flow.md](./refund-flow.md)). Any other refund is still manual via the CHIP dashboard — **define that process** (#509, #510, #511, #512). |
| Participant CSV / Excel export | O8 | ❌ | 🟡 | Transcribe from the roster; needed for pairing software (Swiss-Manager etc.). |
| Non-auth transactional emails | S4, O1, P6, P9 | ⚠️ auth + cancellation only | 🟡 | Cancellation emails ship; CHIP's receipt covers payments. Still missing: registration confirmation (#119), application result (#120), OKU result (#449), refund outcome (#512). |
| Player-initiated registration cancellation | P12 | ❌ | 🟡 | Player forfeits; support handles case-by-case. |
| Admin tournaments / transactions / users pages | A4, A5, A6 | ❌ | 🟡 | Use the Supabase dashboard directly. |
| Self-serve correction of set-once fields / account changes | P5 | ❌ | 🟡 | Support-routed; monitor support load. |
| Support-email inconsistency | V1 | ⚠️ | 🟡 | One-line fix (`mychesstour@gmail.com` → `support@mychesstour.com`), in `joinWaitlist.ts` and `LoginForm.tsx`. |
| Legal pages unreachable from the UI | V1, O1 | ⚠️ | 🟡 | `/terms`, `/privacy`, and the new `/organizer-agreement` exist, but `Footer` is rendered by **no layout**, so they are URL-only outside the signup modals and the apply form. Render the footer. |
| `/my/tournaments` buckets dates in the reader's timezone | P11 | ⚠️ | 🟡 | Untracked. Discovery and the detail page were moved onto each venue's timezone (#343); `RegistrationsClient` still uses browser-local midnight **and buckets on `start_date`**, so a multi-day event reads "past" the day it starts. |
| Prize disbursement to players | P14, P7 | ❌ — not owed by default | 🟢 | Default distribution is `organizer`: the organizer pays winners directly and the platform never holds prize money. Only a `platform` tournament creates an obligation, and Phase 8 (#523) gates that on a fully pre-funded pool. |
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

**Closed since the 2026-07-29 pass** (all on `staging`, suite green at **1738 tests / 112 files**):

- *Audit snapshots carry verbatim bank numbers and OKU document paths* — was the 🔴 half of #503.
  Redacted at write time; what is left of #503 is the retention wording and the deletion scrub.
- *A published tournament could be edited without restriction* (O6) — was a 🟡 "confirm this is
  intended" caveat. Now a **two-stage freeze**, enforced in the route *and* by a trigger.
- *Prizes could be funded from entry fees* — implicit before, now impossible by type and rejected
  at publish.
- *Every tournament rendered and bucketed in one platform-wide timezone* — now per-venue (#343).
- *Terms acceptance was a client-side checkbox that was thrown away* — now a versioned acceptance
  persisted at signup, and an Organizer Agreement acceptance persisted at application (#517).
- *An age-based fee tier authored in the wizard was silently enforced as unrestricted*, and
  reopening a draft cleared its early-bird date and age range (#478) — one canonical mapping now.

---

## 3. Visitor / public flows

### V1. Waitlist signup — ⚠️ Partial
- **Entry:** `/` landing (`src/app/page.tsx`) → `src/components/WaitlistForm.tsx` → server action `src/app/_actions/joinWaitlist.ts` → `waitlist` table.
- **Happy path:** enter email + pick `user_type` (player/organizer) → insert → form swaps to "You're on the list. We'll be in touch."
- **Scenarios:** empty email → blocked client-side (`required`) and server-side; **duplicate** email → Postgres unique-violation (`23505`) is swallowed as an idempotent success (no error shown); other DB error → generic message citing support.
- **Gaps:** ❌ **no confirmation/welcome email** despite "we'll be in touch" copy — a submitter has no proof it worked beyond the UI swap, and the address is never validated (#290 covers the launch mailout). Support-email **inconsistency**: this flow and `LoginForm` cite `mychesstour@gmail.com`, the rest of the app cites `support@mychesstour.com` 🟡.

### V2. Browse & discover tournaments — ✅ Built
- **Entry:** `/tournaments` (`src/app/tournaments/`) → `GET /api/v1/tournaments` (returns `status='published'` only); live spot counts via RPC `get_participant_counts`.
- **Scenarios:** full tournaments show a "Full" badge/disabled state; filters by format/state/rating/date. The state list is now every supported country's regions flattened, from `src/lib/venues.ts` — one source, instead of the same 16 Malaysian states hardcoded in the filter bar and the wizard.
- **Bucketing** is per venue: the page sends the render instant, the client derives each tournament's own "today" from its `timezone` (one lookup per distinct zone), and the 30-day past window compares `YYYY-MM-DD` strings rather than `Date` objects. Still client-side — the API returns every published tournament unfiltered.

### V3. View tournament details — ✅ Built
- **Entry:** `/tournaments/[slug]`. Fee tiers, prizes, eligibility, capacity, deadline; "Register" CTA.
- **Venue timezone (#343):** dates are formatted from the date's own parts and labelled with the venue's zone ("10 Aug 2026 (MYT)"), and "has it started?" is judged against today *at the venue*, not at the reader. Same for deadlines and early-bird cut-offs, which are instants anchored to the venue day.
- **Gaps:** 🟡 the public page does **not** name a prize's funder or frame the entry fee as an administration fee, although both are now stored and both are the framing the money structure rests on (#516 §1D's copy item, not carried out). Special prizes render again (#538) — they were stored but never displayed, and a category-less prize list showed nothing at all.

---

## 4. Player — account & profile

Auth flows (P1–P4) are summarized; see **[authentication-flow.md](./authentication-flow.md)** for
session/token internals. Note the app uses a **custom email-verification code** flow (Redis +
Resend), not Supabase's built-in confirmation link, and **email/password only** (no OAuth/magic-link).

### P1. Signup — ✅ Built
- **Entry:** `/auth/signup`. Three endpoints under `/api/v1/auth/signup/`: `create-account` → `verify-code` → `request-code` (resend).
- **Happy path:** submit name/email/password → account created with a 6-char code emailed via Resend → enter code (15-min TTL) → verified → routed to `/tournaments`. Profile details come later (progressive).
- **Scenarios:** per-IP rate-limit (429); existing email (409); code expiry (410); brute-force guard on verify (429); resend is enumeration-safe (always generic 200); the verify step is URL-gated by a `SIGNUP_STEP_COOKIE`. **Rollback:** if code storage/email fails, both `public.users` and `auth.users` are deleted so a retry isn't blocked.
- **Terms acceptance (#517):** the form now *sends* the consent and the route **rejects a signup without it** — it used to be validated in the browser and discarded, so a direct API call could create an account with nothing on file. The version written is the server's own `TERMS_VERSION`, never the body's (a client-supplied version is not evidence of what was shown); it rides in `raw_user_meta_data` so `handle_new_user` stamps `users.terms_version` + `terms_accepted_at` in the same statement that creates the account, and a `chk_users_terms_shape` CHECK makes a half-written acceptance unstorable.
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
- **Note for whoever builds deletion:** anonymising `users`/`player_profiles` is **cosmetic unless it also scrubs `audit_logs`**, which holds full pre-anonymisation snapshots (S3, #503). Bank numbers and OKU document paths are now masked on the way in, but DOB, gender, `oku_status`, nationality, and `fide_id` are **deliberately kept** — they are what an eligibility dispute turns on — so deletion is the only thing that can remove them. Financial audit rows (`payments`, `refunds`, `registrations`) are exempt under the 7-year obligation. Wire this into the runbook now, while the process is still manual.

### P6. OKU (disability) verification — ⚠️ Partial
- **Entry (player):** `/settings` → `OkuVerificationCard` → upload doc (≤5 MB) to the **private** `oku-documents` bucket → `POST /api/v1/profile/oku` sets `oku_status='pending'`.
- **Entry (admin):** `/admin/oku/[userId]` (signed 300s URL to the doc) → `PATCH /api/v1/admin/oku/[userId]` approve/reject (guarded on `pending`, rejection reason required).
- **Scenarios:** re-upload allowed only in `none`/`rejected`; double-review prevented (404 if already actioned). `oku_document_path` is now masked in audit snapshots — it is a capability-bearing storage path to a medical document, not a label.
- **Gaps:** ❌ **no notification to the player** on approve/reject — the pending card says "we'll update your status" but the player only learns the outcome by revisiting Settings. This blocks OKU-tier registration (see P8) with no ETA 🟡.

### P7. Banking details — ⚠️ Partial (captured, unused)
- **Entry:** `/settings` → `BankingCard` → `PATCH /api/v1/profile/banking`. Account number 5–20 digits, freely editable, **never returned** (last-4 only), and now masked to a last-4 in audit snapshots too. Purpose per UI: "pay out prize winnings and process refunds."
- **Gaps:** ❌ **nothing consumes this** — there is no disbursement path (see P14/O9), no just-in-time prompt forcing a prize winner to add it, and no account verification (#374). `BankingForm` is explicitly scaffolded for a "future" prize-claim/refund surface that does not exist.
- **Note:** this is the *player's* bank row. The *organizer's* payout bank details are a separate thing that does not exist yet — the three dead `organizations.bank_*` columns were **dropped** in Phase 1 (nothing wrote them, and the column-unrestricted "Public can view approved organizations" policy would have exposed them to `anon` the moment anything did). Phase 3 (#518) replaces them with an RLS-gated table.

---

## 5. Player — tournament participation

### P8. Eligibility check — ✅ Built
- **Two layers.** Server (authoritative, at checkout) in `.../tournaments/[slug]/registrations/validators.ts`: `checkRestrictions` (gender/nationality/title/rating/**age as of the tournament start date**), `checkFeeTierEligibility` (female-only, **verified-OKU-only**, titled, age bands), `checkRatedRequirements` (FIDE/MCF id present). Client mirror in `RegisterForm.tsx` → inline `CompleteProfilePrompt` that PATCHes the profile and re-runs eligibility **without leaving checkout**.
- **Key distinction:** a **null** field is "collectable" (fixable inline); a **mismatch** is a hard block.
- **Fixed since the last pass (#478):** the wizard persisted its own dialect of `entry_fees` (`age_from`/`age_to`, a bare date for `valid_until`) while every consumer read the canonical one (`age_min`/`age_max`, an instant). Two consequences, both now closed: reopening a draft silently cleared the early-bird date and the age band, and — worse — `checkFeeTierEligibility` gates on `age_min`/`age_max`, so **an age-based tier authored in the wizard was enforced as unrestricted**. `entryFees.ts` is the single bidirectional mapping, and `valid_until` is stored as an instant anchored to the venue day (`…T23:59:59+08:00`), so an early-bird tier no longer expires at 08:00 on the day the UI says is still included.
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
- **Gaps:** ❌ no "Payment History / download receipt" screen (MVP Flow 5) — CHIP emails the receipt instead 🟢. ⚠️ **this is the one date surface #343 did not move**: `RegistrationsClient` still buckets against browser-local midnight and against `start_date` rather than `end_date`, so a multi-day tournament shows as "past" from the day it starts, and a reader outside the venue's zone can see the boundary a day early. Untracked — open an issue 🟡.

### P12. Registration cancellation (player-initiated) — ❌ Not built
- MVP lists `POST /player/registrations/:id/cancel`; **no route or action exists**. A player who can't attend simply forfeits their seat (and, today, gets no refund).
- The refund *machinery* now exists and is reusable (`refundChipPurchase` + `settle_refund`, see P13) — what's missing is the request path and the policy behind it. Tracked with P13 in **#509**.
- **Priority:** 🟡. Interim: support handles case-by-case.

### P13. Refund request — ⚠️ Partial (cancellation refunds built; nothing else)
- **Built and wired end-to-end:** when an admin approves a tournament cancellation, `review_tournament_cancellation()` queues one `refunds` row per confirmed+paid registration, the admin route fires `refundChipPurchase()` per player, and `settle_refund()` appends the mirrored `type='refund'` ledger row — synchronously on a terminal CHIP response, or from the `payment.refunded` webhook. Idempotent at three layers; covered by route tests and `db/tests/settle_refund.sql`. Full detail in **[refund-flow.md](./refund-flow.md)**.
- **Still missing:** a player cannot request a refund (**#509**); an organizer cannot refund from the roster (**#510**); `refunds.status` has **no read surface at all** outside the Supabase dashboard (**#511**); and no email tells the player the refund actually landed or failed (**#512**). Consequently `refunds.reviewed_by`/`reviewed_at` and the per-refund RLS policies are still unexercised — cancellation refunds are auto-approved wholesale.
- **Open operational risks** on the shipped path (`related_to` parsing #495, inline fan-out timeout #496, no re-fire for stuck `pending` #497, out-of-band CHIP-dashboard refunds #498, monitoring #499) — see [refund-flow.md](./refund-flow.md) §Open risks.
- **Priority:** 🟡 — the launch-blocking case (tournament cancelled, players owed money) is handled; the rest is a support-load and trust question.

### P14. Prize claim / winner payout — ❌ Not built (and, by default, not owed)
- No prize disbursement anywhere; captured banking details (P7) are never read; no `player_prize` payment row is ever created by code.
- **What changed:** prizes are now **externally funded by rule** and each tournament declares a `prizes.distribution` of `organizer` (default) or `platform`. Under the default the organizer pays winners directly and the platform holds no prize money at all — so there is no obligation to disburse, and the payout math carries **no prize holdback**: an organizer's payout is their net revenue in full. `platform` is an opt-in that Phase 8 (#523) will gate on the pool being paid in and fully funded first.
- **⚠️ Live gap — the toggle is already selectable.** `PrizesStep` offers "MY Chess Tour distributes the prizes" with the hint "you or your sponsor pay the prize pool to us up front; we transfer it to the winners after the event", and publish validation only checks that the value is one of the two modes. Nothing collects the pool and nothing pays a winner, so an organizer can publish a tournament that promises a distribution the platform cannot perform. Either disable the `platform` option until Phase 8 (#523) ships, or reject it at publish 🔴.
- **Priority:** 🟢 for the `organizer` default (nothing is owed); 🔴 for the toggle above.

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
- **Organizer Agreement (#517):** the form gates submit on a checkbox linking to `/organizer-agreement`, and the validator rejects anything where `agreement_accepted` is not literally `true`. The three columns (`agreement_version`, `agreement_accepted_at`, `agreement_accepted_by`) are written from the server constant — the validator returns a whitelisted shape, so a version in the request body cannot physically reach the insert. #517 assigned this to Phase 3's new RPC, but wiring it into the existing route means organizers who onboard **before** Phase 3 still have an agreement on file.
- **Gaps:** ❌ **no email on approve/reject** — the MVP says approval "triggers an email notification"; today the applicant must poll 🟡 (#120). ❌ **no KYB documents** are collected or reviewed — that is Phase 3 (#518, #373), and it is what turns an approved org into a payable recipient.

### O2. Organizer dashboard — ✅ Built
- **Entry:** `/my/organizations/[orgId]` → dashboard route. Stats include a **"Pending Payout"** figure computed from the `tournament_payout_summary` view (display only — see O9).
- **Agreement gate (#517):** `AgreementGate` renders a panel when `organizations.agreement_version` is not the current `ORGANIZER_AGREEMENT_VERSION` — either because the version was bumped or because the org predates the agreement. It names **what changed since the version this org accepted** (`changesSince()` over the document history), not whatever the last release touched, so an org that skipped versions sees every one it missed. Acceptance posts to `POST /api/v1/organizations/[orgId]/agreement`, gated on `org.manage` (owner-only, which is right for an instrument that binds the organization), written from the server constant, a no-op when the current version is already stored (re-accepting would only move the timestamp, and the timestamp is the evidence), and deliberately **not** gated on `approval_status='approved'` so a version bump cannot strand an unreviewed org.
- **Note:** the gate is a panel, not a block — the rest of the dashboard still renders and the organizer can still create and publish. Its teeth arrive with the payout functions in Phases 5–6, which must refuse to move money on a stale agreement. Until then it is a prompt 🟡.

### O3. Team / member management — ⚠️ Partial
- **Entry:** members page → `POST /api/v1/organizations/[orgId]/members/invite`. Existing user → membership inserted directly (active); new user → Supabase `inviteUserByEmail` + pending membership. Role change/remove via `PATCH`/`DELETE .../members/[id]` (needs `org.manage`); you cannot change/remove yourself; owner is not assignable here.
- **Gaps:** ❌ **no acceptance workflow, no resend, no expiry** for pending invites (the MVP shows a "Resend" affordance); no leave-org 🟢.

### O4. Create tournament (5-step wizard) — ✅ Built
- **Entry:** `/my/organizations/[orgId]/tournaments/create` → `POST .../tournaments`. Owner/admin of an **approved** org. Saved as `draft` with placeholder dates so incomplete drafts persist. Restrictions & fee tiers (early-bird/titled/rating/age; female/OKU tiers) authored here.
- **New in the wizard:** a **venue country** (`src/lib/venues.ts`) driving the region select, and a **venue timezone** picked from the ASEAN + Timor-Leste picklist (`VENUE_TIME_ZONES` in `src/lib/datetime.ts`); the server resolves whatever arrives against that picklist, so an unknown zone can never reach a formatter. Per-category **prize funding** (source + funder name) and the distribution toggle (see P14). `FormatStep` finally validates that a start date is in the **future** — without it a draft could be saved in a state that made it simultaneously unpublishable and uneditable.
- **Persistence hardening:** wizard state now uses the canonical `snake_case` tier discriminators (the same strings `registrations.fee_tier` records and checkout matches on) and keys restriction rows by a `RestrictionKind` instead of the dropdown's display label — rewording an option used to silently break persistence, and an unrecognised label threw at runtime. Tiers the wizard has no editor for (gender/OKU) are skipped on read rather than coerced into an early-bird row and rewritten on save.

### O5. Publish tournament — ✅ Built
- **Entry:** `POST .../tournaments/[id]/publish`. **Only `draft` can publish** (else 409). Full required-field validation (rejects placeholders → 422 with `details[]`). Assigns a unique slug on first publish, stable on re-publish.
- **Prize funding is now part of that validation.** Every prize category *and* special prize carrying money must name a `funding.source` (`sponsor` | `grant` | `organizer`) and a non-empty funder; `entry_fees` is not a member of the type, so it cannot be selected. Empty categories are exempt — a category with no amount is a structural placeholder, not a promise to pay. `validatePrizeStructure` (#538) additionally rejects malformed prize shapes that previously reached the public page. **Tournaments created before funding was declarable hydrate with no source and must choose one before they can be re-published.**
- The "start date must be in the future" check now reads **today at the venue**, not the server's day — the same correction was applied to the cancel route.

### O6. Edit tournament — ✅ Built (two-stage freeze)
- **Entry:** `PATCH .../tournaments/[id]` (owner/admin). Partial field update. The previous pass flagged that there were **no guards at all**; #516 added two, because the two risks arrive at different moments:
  - **Money fields** — `entry_fees`, `prizes`, `max_participants`, `commission_rate`, `organizer_commission_pct` — freeze at the **first paid registration**. Changing them afterwards rewrites a concluded transaction, and moving `prizes` would shift the payout holdback under a tournament that is already selling. Not frozen at publish, so a typo on a listing nobody has bought into is still fixable.
  - **Everything else** freezes once the tournament **starts**, mirroring the rule the cancel route already applies. Drafts are exempt from both (their placeholder dates would otherwise read as long past).
- **Enforced twice on purpose.** `guard_tournament_money_fields` (BEFORE UPDATE trigger) is the authority, so the rule survives any writer including the service role and the SQL editor; the route produces the readable 409 naming the rejected fields. The started-at half lives in the route only — it depends on today-in-the-venue-timezone, and a second definition in SQL would be free to drift.
- **The freeze compares values, not presence.** The edit wizard rebuilds the whole body on every save, so gating on "is this field in the patch?" refused an organizer who had corrected a venue address on a tournament with one paid registration — an edit the database would have accepted. Comparison is structural rather than `JSON.stringify`, because jsonb equality ignores key order.
- **Remaining caveat:** the slug is still not recomputed on rename 🟢.

### O7. Close registration / cancel tournament — ✅ Built
- **Close registration early:** `POST .../tournaments/[id]/close-registration` — stamps `registration_closed_at`, which is also populated on publish (from `registration_deadline`) so the two paths can't drift. Checkout and the public detail page both read it.
- **Cancel:** two-step, because cancelling a published tournament moves money. The organizer files a request via `POST .../tournaments/[id]/cancel` (blocked for ongoing/completed tournaments — a check that now reads **today at the venue**, not the server's day); a platform admin reviews it at `/admin/cancellations` → `PATCH /api/v1/admin/tournament-cancellations/[id]`. Approve runs `review_tournament_cancellation()`, which flips `tournaments.status='cancelled'` **and** queues a refund per paid registration in one transaction, then the route fires the CHIP refunds and emails every registered player.
- **Gaps:** none blocking. The refund fan-out runs inline in the admin request (#496) and there is no re-fire for a refund left `pending` (#497).
- **Coming interaction with payouts:** once Phase 5 can pay an organizer, a *paid* payout makes a later cancellation unfundable — refunds pay every player their full gross from the Collect balance while the organizer's net has already left via Send. Phase 6 blocks cancellation approval when a paid payout exists, and there is **no automated claw-back** (recovery is a manual `payment_type='adjustment'` row plus an ops process). Worth knowing before the first payout, not after.

### O8. Participant roster / management — ⚠️ Partial
- **Entry:** tournament manage page → `getTournamentManageData` (roster with statuses, live expiry sweep).
- **Gaps:** ❌ **no CSV/Excel export** (MVP Flow 4) — organizers need participant lists to seed pairing software 🟡 (#90); ❌ no per-row "refund" / "cancel registration" actions (MVP Flow 4) — this would be the first code to actually check the `refund.manage` permission (#510).

### O9. Payout — ⚠️ Partial (view/display only, but now sequenced)
- **Entry:** the `tournament_payout_summary` **view** aggregates the payments ledger into `net_payout_cents`, surfaced as the dashboard "Pending Payout" stat. `idx_payments_payout_summary` now covers `organizer_payout` too — its partial predicate previously left the view's payout sum uncovered.
- **Gaps:** ❌ **no `/my/organizations/[orgId]/payouts` page** (MVP Flow 5 — the directory doesn't exist; #93–#96); ❌ **no disbursement** — no payout route, no `organizer_payout`/`player_prize` rows are ever *created* by code, no CHIP Send call, no status machine. The organizer sees an amount owed; the actual money movement is still manual, out-of-band, and unrecorded.
- **The plan (#515), and where it has got to.** Eight phases, dependency-ordered:

  | Phase | What | State |
  |---|---|---|
  | 1 (#516) | Data-integrity foundations — audit redaction, venue country/timezone, edit freeze, prize funding | ✅ merged |
  | 2 (#517) | Legal — versioned Organizer Agreement + ToS acceptance | ✅ merged |
  | 3 (#518) | Organizer onboarding — bank details + KYB documents, admin-reviewed | ❌ |
  | 4 (#519) | CHIP Send client + bank-account verification | ❌ |
  | 5 (#520) | Payouts core — `payouts` table, `settle_payout`, execute, beneficiary | ❌ |
  | 6 (#521) | Early payout request (≤50% of net, post-registration-close, max 2, admin-approved) + emails | ❌ |
  | 7 (#522) | Automatic payout cron — 3 days after the last session, in the venue's timezone | ❌ |
  | 8 (#523) | Platform-managed prize pool — collection + distribution | ❌ |

  Decisions already taken and reflected in the schema: the organizer receives **net revenue in full** (no prize holdback, because entry fees never fund prizes), commission is capped at 10% (`chk_commission_rate`), and the beneficiary must be another approved organization.
- **Not a code task, and on the critical path:** CHIP Send requires the merchant to register a primary Send email and every budget approver with a CHIP account manager **before any integration works**. That has vendor lead time — start it now (risk 3 on #515).
- **Priority:** 🔴 — nothing is *due* until the first tournament ends, but the process (even if manual for the first events) must be defined and recorded before launch, and the vendor setup started well before Phase 4.

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
- **Two admin surfaces are already owed by the payout plan** and do not exist yet: KYB document review (Phase 3, #518) and early-payout approve/reject (Phase 6, #521). Neither is a new page pattern — `/admin/oku` and `/admin/cancellations` are the precedents.

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

### S3. Audit logging — ⚠️ Partial (redacted at write time, still unbounded)
- **Built:** `audit_trigger_func` writes to `audit_logs` on inserts/updates/deletes of the sensitive tables, storing full `old_data`/`new_data` jsonb snapshots.
- **Write-time redaction — ✅ done (#516).** `redact_jsonb_columns(p_data, p_cols)` (IMMUTABLE) replaces a value with `'****' || right(value,4)`, and `audit_trigger_func` applies it to both snapshots for `player_profiles.bank_account_number` and `oku_document_path` — the latter because it is a capability-bearing path to a private-bucket medical document, not a label. Redaction runs *after* `record_id` extraction, so a redacted column can never become the PK. Covered by `db/tests/audit_redaction.sql`.
- **Deliberately still captured:** `date_of_birth`, `gender`, `oku_status`, `nationality`, `fide_id`. These are exactly what an eligibility dispute turns on ("the organiser says I was entered in the wrong age band"), so their audit value is real — the deletion path, not the trigger, is what must remove them.
- **Gap — what is left of #503 🟡.** (a) The `/privacy` retention table (and its `PrivacyModal` duplicate) **still does not list `audit_logs`**, so the published commitment remains incomplete. (b) `anonymise_user_audit_logs(p_user_id)` — redact the snapshots for `users`/`player_profiles` rows on deletion, null the `changed_by` references, and deliberately **not** touch `payments`/`refunds`/`registrations` (7-year retention overrides) — does not exist; ties to the missing self-serve deletion in P5. Dropped from 🔴 because new rows are already redacted and the schema has never been applied to production (#161), so there is no backlog of unredacted live rows to chase.
- **Fixed alongside:** the `/privacy` encryption claim, which said sensitive and financial data are "encrypted at rest" when nothing is column- or application-encrypted. It now states what is true — TLS in transit, encrypted storage volumes, RLS, masked bank numbers in audit snapshots, private document storage — and says plainly that individual fields are not separately encrypted. KYB documents are disclosed as a data category and a retention row ahead of Phase 3 collecting them, and CHIP is named as the processor that receives bank details.
- **Related, unfixed:** `changed_by` is null on everything but trigger/seed context (#470), which limits what the trail can attribute.
- **Gap — retention 🟢 (#507).** No retention policy and no pruning. `FOR EACH ROW` on INSERT/UPDATE/DELETE across nine tables with two snapshots each means this will be the largest table by row count long before `payments` is. Not urgent (no volume yet), but it needs `prune_audit_logs` with dry-run + batched deletes, an index on `(table_name, created_at)`, and a schedule — which needs `pg_cron`, the **same missing prerequisite as S2**. Land them together.

### S4. Transactional email — ⚠️ Partial (auth + cancellation)
- Provider Resend (`src/services/email/email.ts`) exports **four** senders: `sendVerificationEmail`, `sendPasswordResetEmail`, `sendTournamentCancellationEmail` (all registered players), and `sendCancellationReviewEmail` (organizer, approved/rejected). Templates for the last two live alongside them in `templates/`. The remaining template files (change-email, reauthentication, magic-link, invite) are Supabase-dashboard copies, **not wired to app code**.
- **Gaps:** ❌ registration/payment confirmation (#119), application result (#120), member invite (#121), OKU result (#449), tournament reminders, and **refund outcome** (#512) — the cancellation email promises a refund and nothing ever confirms it landed. See the **Communications** gap in §9. 🟡 Phase 6 (#521) adds early-payout decision emails, so the sender list grows with the payout work whether or not the backlog above is cleared first.

### S5. Notifications (in-app / SMS / push) — ❌ Not built
- No `notifications` table or service, no SMS, no web-push. 🟢

### S6. Observability (error monitoring / analytics) — ❌ Not built
- No Sentry, no Plausible/Umami — nothing in dependencies or code. For a launch that handles money, **error monitoring + alerting is operationally important** (it's also where P10's "logged for manual ops" reconciliations would surface).
- **Priority:** 🔴 (operational) — add basic error monitoring + an uptime check before launch.

### S7. Schema groundwork (identity indirection + ledger integrity) — ⚠️ Partial
Not a user flow — schema items whose cost depends on *when* they're done, which is why they sit
on the pre-launch list despite being invisible to users. None changes behaviour.

- **Legal acceptance — ✅ Built (#517).** `users.terms_version` / `terms_accepted_at` and
  `organizations.agreement_version` / `agreement_accepted_at` / `agreement_accepted_by`, each pair
  guarded by a `chk_*_shape` CHECK so a version without a timestamp cannot be stored — a
  half-written acceptance proves nothing, and the constraint is what stops one existing. Versions
  are ISO dates, so string comparison and chronological order agree; `src/lib/legal.ts` derives
  "current" from the newest history entry, so the rendered document and the recorded version cannot
  disagree. The agreement columns sit on `organizations` despite its column-unrestricted public
  SELECT policy — a version string, a timestamp and an opaque user id are no more revealing than
  the `created_by`/`reviewed_by` already on that row, and the schema comment says so explicitly so
  it is not read as a precedent for the bank columns that were deliberately kept off. Covered by
  `db/tests/legal_acceptance.sql`.

- **Identity indirection — ✅ Built, not yet applied (#501).** `users.auth_user_id` is now the only link to Supabase Auth; `app_user_id()` resolves a JWT `sub` to a `users.id` and **every** RLS policy and storage policy goes through it (`auth.uid()` appears nowhere else). `can_act_for()` is in place as a seam — currently the bare self check, used by the `player_profiles` / `registrations` / `payments` / `refunds` policies so P15 changes one function body instead of sweeping every policy again. `users`, `user_global_roles`, `organization_memberships`, and the own-account `audit_logs` policy deliberately do **not** use it and are commented as such at each site. App side: `AuthIdentity.id` is now the `users.id` (with `authUserId` alongside for Supabase Auth calls), so the ~59 call sites that read `claims.id` became correct without individual edits; `lookupAppUserId` (`src/services/supabase/identity.ts`) is the single bridge. **One route needed a separate fix:** `tournaments/[slug]/checkout` authenticates with `getUser()` rather than `getAuthClaims()` — the deliberate exception from #363, kept for an immediate revocation check before taking money — so it never appeared in a `claims.id` sweep and was still passing the raw auth id into `player_profiles`, `registrations`, and `create_registration_with_payment`. It now resolves through `lookupAppUserId` and fails closed (401) on an unlinked session. A full re-audit of every identity source and every `user_id` / `p_user_id` argument confirms it was the only one. Because `handle_new_user` writes `auth_user_id = id` for self-signup, **nothing changes behaviour** — verified by the full suite (1519 green) and `db/tests/identity_indirection.sql`, which uses deliberately divergent ids so a policy still comparing `auth.uid()` fails loudly.
  - **Hardening found while reviewing this:** `users` had a blanket client UPDATE policy with no column restriction, so anyone holding a user's JWT could `PATCH /rest/v1/users` to null their own `auth_user_id` (orphaning the record permanently) or set `is_verified: true` (skipping the emailed code — a pre-existing hole, unrelated to #501). No application code needed the policy: every `users` write goes through the service-role client. Client UPDATE/INSERT/DELETE is now revoked outright, with `guard_users_identity_columns` as a trigger-level backstop on `id`/`auth_user_id`. See [roles-and-permissions.md](./roles-and-permissions.md).
  - **Test-suite guard:** `src/test/setup.ts` now stubs the identity lookup so the auth and app id spaces **differ across the whole suite** (`appIdFor`). Previously they matched, which is exactly why a route passing a raw auth id was indistinguishable from a correct one and survived a full sweep — reintroducing the checkout bug now fails ordinary route tests, not just bespoke ones.
  - **Outstanding:** the schema has not been applied to any environment (ties to #161), and the query-plan check the issue asked for (`app_user_id()` is `STABLE`, but confirm no regression on `/my/tournaments` and checkout) needs a live database. The array-shaped checkout response — #501 part 3 — was split out to **#513** as speculative and, unlike the rest, no more expensive later.
- **Ledger integrity — 🟡 (#502).** Two gaps that exist *today*, independent of the deferred cluster. (a) `payments` records the pricing **output** but not the **input** — the fee tier lives on the mutable `registrations.fee_tier`, which reflects only the current attempt. If a corrected DOB or a completed OKU verification moves a player between tiers mid-retry, the ledger shows two attempts at different amounts with nothing recording why; `start_new_payment_attempt` already receives `p_fee_tier` and simply doesn't persist it on the immutable row. (b) Nothing forces `cancelled_at` to be set when a registration goes terminal or cleared when a late `paid` rescues it — that pairing is convention inside two functions today, and the number of paths that terminalize a registration is about to grow (P12, refunds, cart expiry).

---

## 9. Cross-cutting gaps (prioritized)

1. **Money-out — 🔴/🟡.** Organizer payouts (O9) are still unbuilt and captured banking (P7) is still unused, but the work is now sequenced as #515 Phases 3–8 and the foundations under it have landed. Prize disbursement (P14) has largely **dissolved as an obligation** — entry fees never fund prizes and the default distribution is `organizer` — except that the `platform` option is selectable today with nothing behind it 🔴. Refunds remain unblocked: the cancellation path moves money automatically (P13), leaving 🟡 gaps for player/organizer-initiated refunds (#509, #510) and refund visibility (#511). *Interim for payouts:* manual disbursement + a tracking sheet, but **define and record the process** before taking real money — and start the CHIP Send vendor setup now, since it gates Phase 4 and is not a code task.
2. **Observability — 🔴 (operational).** No error monitoring/alerting (S6) for a money-handling app. *Interim:* none — add Sentry + uptime before launch. Now doubly relevant: refunds settle asynchronously and a failed one is currently silent (#499).
3. **Data protection — 🟡 (compliance), down from 🔴.** Bank numbers and OKU document paths are redacted out of audit snapshots at write time and the `/privacy` encryption claim has been corrected (S3, #516). What remains of #503 is the retention table still not listing `audit_logs` and the deletion-path scrub not existing. Retention/pruning (#507) is the 🟢 follow-on.
4. **Legal — 🔴 (review, not code).** The versioned-acceptance machinery is live and the Organizer Agreement's fifteen clauses are each tied to something the code actually does, but the **wording has not been reviewed by anyone qualified** (#515 risk 2, #376), and the prize-funding rule it encodes is a design decision awaiting a Shariah advisor's confirmation. Both are launch gates that no amount of engineering closes.
5. **Cheap-now, expensive-later schema — 🟡.** Identity indirection (#501) and legal acceptance (#517) are **done** — both landed while they were still small. Ledger integrity (#502) remains: two real gaps in the money trail that get worse once there are payments to reconstruct (S7). *Interim:* none — that's the point of the priority.
6. **Communications — 🟡.** Auth + cancellation emails exist (S4); most MVP-promised emails don't. *Interim:* rely on the CHIP receipt for payments; manually email organizers on approval and players on OKU decisions. Recommend at least registration-confirmation, application/OKU-result, and refund-outcome (#512) emails.
7. **Organizer event-running tooling — 🟡.** No participant CSV/Excel export (O8, #90) — core to actually running an event (pairing software). Recommend for launch.
8. **Admin tooling — 🟡.** No admin tournaments/transactions/users pages (A4–A6); `/admin/cancellations` is the one operational admin screen beyond applications/OKU. *Interim:* Supabase dashboard. Phase 3 (KYB review) and Phase 6 (early-payout approval) add two more admin screens to this list.
9. **Support-load risks — 🟡.** Set-once profile fields with no self-serve correction, and no self-serve email/name change or account deletion (P5); support-email inconsistency (V1, a trivial fix). These convert small user mistakes into support tickets. Account deletion is also a prerequisite for the audit-log scrub in #503, and P16 would make the missing correction path more visible.
10. **Auth niceties — 🟢.** No OAuth/magic-link (email+password is fine); no logout-everywhere.
11. **Deferred platform capabilities — 🟢.** Dependent accounts (P15, #504), account claiming (P16, #505), and multi-participant checkout (P17, #506). Sequenced and costed; unstarted on purpose. *Interim:* one account and one checkout per player — ship it that way and let real demand decide.

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
- [ ] **[O9]** Define how organizer payouts are disbursed and recorded for the first events, and **start the CHIP Send account-manager setup now** — it gates Phase 4 and has vendor lead time. 🔴
- [ ] **[O9]** Decide whether the first events run on the manual process or wait for Phases 3–5 (#518–#520). 🔴
- [ ] **[P14/O4]** Disable the `platform` prize-distribution option (or reject it at publish) until Phase 8 exists — it currently promises a distribution the platform cannot perform. 🔴
- [ ] **[O1/O2]** Get the **Organizer Agreement wording reviewed by someone qualified** (#376) — it is what makes the payout claw-back enforceable. 🔴
- [ ] **[O4/O5]** Confirm the **prize-funding rule** (entry fees are an administration fee; prizes must be externally funded) with a qualified Shariah advisor before launch (#515). 🔴 — a different answer changes publish validation and Phase 8, nothing else.
- [x] **[S3]** Redact `bank_account_number` and `oku_document_path` from audit snapshots (#516) — landed before any environment had real rows.
- [ ] **[S3]** Publish an `audit_logs` row in the `/privacy` retention table *and* `PrivacyModal` (they duplicate the same prose), and build `anonymise_user_audit_logs()` for the deletion path (#503). 🟡
- [ ] **[S3]** Get the retention wording reviewed by a second person before it ships — it amends a published compliance commitment.
- [x] **[S7]** Identity indirection (#501) — landed pre-launch, so the sweep never had to touch live payment records.
- [ ] **[S7]** Apply `db/migrations/001`–`007` (ties to #161), then run `db/tests/identity_indirection.sql` and check the query plans on `/my/tournaments` and checkout for regression from the `app_user_id()` lookup. 🔴
- [ ] **[S7]** Add `payments.fee_tier` and the `cancelled_at` consistency constraint (#502) — verify no existing row violates the constraint on staging *and* production first. 🟡
- [ ] **[P15–P17]** Confirm the team is happy deferring dependents, claiming, and carts — and that one-checkout-per-player is acceptable for the first events. 🟢

**Visitor**
- [ ] **[V1]** Fix the support-email inconsistency (`mychesstour@gmail.com` → `support@mychesstour.com`) in `joinWaitlist.ts` and `LoginForm.tsx`.
- [ ] **[V1]** Decide whether the waitlist needs a confirmation email (#290).
- [ ] **[V1/O1]** Render `Footer` somewhere — `/terms`, `/privacy`, and `/organizer-agreement` are otherwise reachable only by typing the URL.
- [ ] **[V2/V3]** Verify browse, filters, full-badge, and detail render for a published tournament, **in more than one venue timezone** — create a non-MY tournament and confirm its card, detail, deadline, and past/upcoming bucket all read in the venue's zone.
- [ ] **[V3]** Decide whether the public page should name each prize's funder and frame the entry fee as an administration fee — the data is stored, the copy was never written.

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
- [ ] **[P11]** Verify My Tournaments listing + lazy expiry, and file the date-bucketing bug (browser-local midnight, buckets on `start_date`) that #343 left untouched.

**Organizer**
- [ ] **[O1]** Test apply → admin approve → owner membership appears; decide on the approval email.
- [ ] **[O4/O5]** Test the create wizard → publish (validation + slug) happy path, including a **draft saved and reopened** (fee criteria and age bands must survive) and a publish blocked for a priced prize with no funding source.
- [x] **[O6]** Decide whether editing a *published* tournament (dates/fees) after registrations is allowed — resolved by the two-stage freeze (#516): money fields lock at the first paid registration, everything else at tournament start.
- [ ] **[O6]** Test both freeze stages against the wizard's real payload: a venue-address edit with one paid registration must still succeed; an `entry_fees` change must 409 at the route *and* raise `P0001` at the trigger.
- [ ] **[O1/O2]** Walk an organizer through apply-with-agreement → approve → dashboard, then bump `ORGANIZER_AGREEMENT_VERSION` on staging and confirm the gate appears, lists the change, and clears on accept (owner only).
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
- [ ] **[S7]** Run the new DB tests against the applied schema alongside the existing ones: `db/tests/audit_redaction.sql`, `db/tests/legal_acceptance.sql`, `db/tests/tournament_payout_summary.sql`.
