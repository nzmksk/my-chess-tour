# MY Chess Tour — Launch Readiness: User & Process Flows

> Pre-launch review of **every** user and process flow in the platform: its entry point, happy
> path, alternate/error scenarios, whether it is **built / partial / not built**, and the gaps
> to close (or consciously defer) before going live. Written for developers, AI agents, and
> product — read it alongside the deep-dives it links to: [payment-flow.md](./payment-flow.md),
> [authentication-flow.md](./authentication-flow.md), [chip-webhook.md](./chip-webhook.md), and
> the original intent in [mvp.md](./mvp.md) §"User Flows & Wireframes".
>
> **Snapshot:** 2026-07-06 · app `0.6.1-alpha` · branch `staging`. The public site is still a
> "Coming Soon" waitlist; the full app is built behind it. This doc reflects the code at that
> snapshot — re-verify the ❌/⚠️ items before acting on them, they are the ones most likely to
> change.

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

The **money-out** half is not: refunds, organizer payouts, and prize disbursement are schema/view
only — no code moves money back out, and captured bank details are never read. A **published
tournament cannot be cancelled in-app** by anyone. **Communications** are auth-only (verification +
password reset); every "we'll email you" promised in the MVP spec is absent (CHIP's own receipt is
the sole payment email). And there is **no production error monitoring**.

### Gap table

Ordered by priority. "Flow(s)" reference the IDs used in §3–§8.

| Feature | Flow(s) | Status | Priority | Interim option |
|---|---|---|---|---|
| Refund request & processing | P13, O8 | ❌ schema+RLS only | 🔴 | Manual via CHIP dashboard + a tracking sheet; **define the process** before launch. |
| Cancel / close a published tournament | O7, A4 | ❌ | 🔴 | Manual DB update + manual refunds. Add at least an admin cancel action. |
| Production error monitoring / alerting | S6 | ❌ | 🔴 | Add Sentry (or similar) + an uptime monitor before taking real money. |
| Organizer payout disbursement | O9, P7 | ⚠️ view only | 🔴 | Manual bank transfer + record it. Nothing is *due* until the first tournament ends — but define it now. |
| Prize disbursement to players | P14, P7 | ❌ | 🟡 | Manual; same timing/mechanism as payouts. |
| Participant CSV / Excel export | O8 | ❌ | 🟡 | Transcribe from the roster; needed for pairing software (Swiss-Manager etc.). |
| Non-auth transactional emails | S4, O1, P6, P9 | ⚠️ auth-only | 🟡 | CHIP receipt covers payments; manually email organizers/players on approvals/decisions. |
| Player-initiated registration cancellation | P12 | ❌ | 🟡 | Player forfeits; support handles case-by-case. |
| Admin tournaments / transactions / users pages | A4, A5, A6 | ❌ | 🟡 | Use the Supabase dashboard directly. |
| Self-serve correction of set-once fields / account changes | P5 | ❌ | 🟡 | Support-routed; monitor support load. |
| Support-email inconsistency | V1 | ⚠️ | 🟡 | One-line fix (`mychesstour@gmail.com` → `support@mychesstour.com`). |
| Member-invite acceptance / resend / expiry | O3 | ❌ | 🟢 | Direct insert already works; re-invite manually. |
| Payment-expiry scheduled backstop | S2 | ⚠️ lazy-on-read | 🟢 | Lazy sweep + CHIP `due` suffice; add `pg_cron` later. |
| In-app notifications / SMS / push | S5 | ❌ | 🟢 | Not needed for launch. |
| Payment history / receipts screen | P11 | ❌ | 🟢 | CHIP emails the receipt. |
| OAuth / magic-link login | P2 | ❌ | 🟢 | Email + password works. |
| Dashboard charts | A1 | ❌ | 🟢 | Stats are shown as numbers. |

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
- **Gaps:** amount-mismatch and `chip_transaction_id`-persist failures are **logged for manual ops** with no alerting 🟡 (ties to S6). Expiry has **no scheduled backstop** — lazy-on-read only 🟢 (see S2).

### P11. My Tournaments — ✅ Built
- **Entry:** `/my/tournaments` → `GET /api/v1/me/registrations` (runs a lazy expiry sweep on read). Upcoming/past/cancelled with status badges.
- **Gaps:** ❌ no "Payment History / download receipt" screen (MVP Flow 5) — CHIP emails the receipt instead 🟢.

### P12. Registration cancellation (player-initiated) — ❌ Not built
- MVP lists `POST /player/registrations/:id/cancel`; **no route or action exists**. A player who can't attend simply forfeits their seat (and, today, gets no refund).
- **Priority:** 🟡 — tied to refunds (P13). Interim: support handles case-by-case.

### P13. Refund request — ❌ Not built (schema + RLS only)
- The `refunds` table, `refund_status` enum, and RLS policies (players insert/view own; org members with `refund.manage` view; admins full) all exist, and the payout view already subtracts paid refunds. But there is **no API route, no UI, and no CHIP refund call** — the CHIP client exposes only create/get/cancel-purchase, not refund.
- **Reality today:** any refund is out-of-band via the CHIP dashboard and **unrecorded** in the app.
- **Priority:** 🔴 — for a real-money launch a refund path must exist, even if it starts as a **defined manual process** with a tracking record.

### P14. Prize claim / winner payout — ❌ Not built
- No prize disbursement anywhere; captured banking details (P7) are never read; no `player_prize` payment row is ever created by code.
- **Priority:** 🟡 (money owed to players; timing is post-event). Interim: manual, alongside organizer payouts (O9).

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

### O7. Close registration / cancel tournament — ❌ Not built
- There is **no close-registration and no cancel action anywhere** — no route, no `DELETE`, and the `cancelled` enum value plus the `tournament.delete` permission are defined but **unused**. `.../tournaments/[id]/route.ts` exposes only `GET` and `PATCH`. Registration closes purely by time (`registration_deadline`).
- **Consequence:** a published tournament **cannot be cancelled in-app by the organizer or an admin** — e.g. if the venue falls through.
- **Priority:** 🔴 — at minimum add an admin cancel action; pair it with a refund process (P13).

### O8. Participant roster / management — ⚠️ Partial
- **Entry:** tournament manage page → `getTournamentManageData` (roster with statuses, live expiry sweep).
- **Gaps:** ❌ **no CSV/Excel export** (MVP Flow 4) — organizers need participant lists to seed pairing software 🟡; ❌ no per-row "refund" / "cancel registration" actions (MVP Flow 4).

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

### A4. Admin tournament moderation — ❌ Not built
- MVP lists an `/admin/tournaments` panel; **no route/page exists**. Admins cannot moderate or cancel tournaments in-app (overlaps O7). Interim: Supabase dashboard. 🟡

### A5. Admin transactions view — ❌ Not built
- MVP lists `/admin/transactions`; **no route/page exists**. No in-app view of payments/refunds. Interim: Supabase dashboard. 🟡

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
- **Gaps:** 🟢 no `pg_cron` backstop (there is no scheduler in the Netlify/`next start` deploy). The unscoped RPC call already exists for when one is added.

### S3. Audit logging — ✅ Built
- `audit_trigger_func` writes to `audit_logs` on inserts/updates/deletes of the sensitive tables.

### S4. Transactional email — ⚠️ Partial (auth-only)
- Provider Resend (`src/services/email/email.ts`) exports **exactly two** functions: `sendVerificationEmail` and `sendPasswordResetEmail`. The other template files present (change-email, reauthentication, magic-link, invite) are Supabase-dashboard copies, **not wired to app code**.
- **Gaps:** ❌ every other email is missing — registration/payment confirmation, receipts, OKU result, application result, tournament reminders. See the **Communications** gap in §9. 🟡

### S5. Notifications (in-app / SMS / push) — ❌ Not built
- No `notifications` table or service, no SMS, no web-push. 🟢

### S6. Observability (error monitoring / analytics) — ❌ Not built
- No Sentry, no Plausible/Umami — nothing in dependencies or code. For a launch that handles money, **error monitoring + alerting is operationally important** (it's also where P10's "logged for manual ops" reconciliations would surface).
- **Priority:** 🔴 (operational) — add basic error monitoring + an uptime check before launch.

---

## 9. Cross-cutting gaps (prioritized)

1. **Money-out — 🔴/🟡.** Refunds (P13), organizer payouts (O9), and prize disbursement (P14) are unbuilt; captured banking (P7) is unused. *Interim:* handle manually via the CHIP dashboard + a tracking sheet — but **define and record the process** before taking real money. Blocked partly by #2 (you can't refund a tournament you can't cancel).
2. **Tournament cancel / close — 🔴.** No in-app path for organizer *or* admin to cancel a published tournament (O7, A4). *Interim:* manual DB update + manual refunds. Recommend at least an admin cancel action pre-launch.
3. **Observability — 🔴 (operational).** No error monitoring/alerting (S6) for a money-handling app. *Interim:* none — add Sentry + uptime before launch.
4. **Communications — 🟡.** Only auth emails + CHIP's own receipt exist (S4). *Interim:* rely on the CHIP receipt for payments; manually email organizers on approval and players on OKU decisions. Recommend at least registration-confirmation + application/OKU-result emails.
5. **Organizer event-running tooling — 🟡.** No participant CSV/Excel export (O8) — core to actually running an event (pairing software). Recommend for launch.
6. **Admin tooling — 🟡.** No admin tournaments/transactions/users pages (A4–A6). *Interim:* Supabase dashboard.
7. **Support-load risks — 🟡.** Set-once profile fields with no self-serve correction, and no self-serve email/name change or account deletion (P5); support-email inconsistency (V1, a trivial fix). These convert small user mistakes into support tickets.
8. **Auth niceties — 🟢.** No OAuth/magic-link (email+password is fine); no logout-everywhere.

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
- [ ] **[P13/O7]** Define the refund process (even if manual) and how it's recorded. 🔴
- [ ] **[O7/A4]** Provide a way to cancel a published tournament. 🔴
- [ ] **[O9/P14]** Define how organizer payouts and player prizes are disbursed and recorded. 🔴

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
- [ ] **[O8]** Provide participant export (CSV/Excel) or a documented workaround for pairing.
- [ ] **[O3]** Confirm invite (existing + new user) works; accept that resend/expiry are absent.

**Admin**
- [ ] **[A1]** Verify dashboard stats load and match reality.
- [ ] **[A2/A3]** Test application and OKU review (approve/reject with reason).
- [ ] **[A4/A5/A6]** Confirm the team is comfortable using the Supabase dashboard for tournament moderation, transactions, and user management until those pages exist.

**System**
- [ ] **[S1]** Trigger the FIDE cron manually (`workflow_dispatch`) once against production; confirm counts.
- [ ] **[S2]** Accept lazy expiry for launch, or schedule the backstop.
- [ ] **[S4]** Confirm only verification + password-reset emails are expected to send at launch.
```
