# MY Chess Tour — API Reference

What the HTTP API under `src/app/api/v1` actually is: every route, who may call it, and the conventions they share. The route files are the source of truth. Request and response shapes are documented in each route's header comment and its `__tests__`, and the money flows are walked through end to end in their own pages:

- [authentication-flow.md](./authentication-flow.md): sessions, `getAuthClaims()` vs `getUser()`, the proxy
- [roles-and-permissions.md](./roles-and-permissions.md): the roles and permission keys referenced below
- [payment-flow.md](./payment-flow.md), [refund-flow.md](./refund-flow.md), [payout-flow.md](./payout-flow.md), [prize-flow.md](./prize-flow.md): the money paths
- [chip-webhook.md](./chip-webhook.md): the two CHIP webhooks

## Table of Contents

1. [Authentication & authorization](#1-authentication--authorization)
2. [Conventions](#2-conventions)
3. [Endpoints](#3-endpoints)
4. [Errors](#4-errors)
5. [Rate limiting](#5-rate-limiting)
6. [CORS and origin policy](#6-cors-and-origin-policy)

---

## 1. Authentication & authorization

- **Sessions** are Supabase Auth cookies (`sb-*`), email + password only. The proxy (`src/proxy.ts`) verifies and refreshes the JWT on every matched request, including `/api`. Routes read the caller with `getAuthClaims()`, which returns the `public.users.id` as `id`. The one exception is checkout, which also calls `getUser()` for an immediate revocation check before taking money.
- **Sign-in, sign-out and password reset are server actions, not API routes:** `src/app/auth/login/_actions/login.ts`, `logout/_actions/logout.ts`, `forgot-password/_actions/forgotPassword.ts` and `update-password/_actions/updatePassword.ts`. Only signup (three steps) and the email-link callback are routes.
- **Authorization** is data-driven: roles map to permission keys (`roles`, `permissions`, `role_permissions`), checked with `has_org_permission` / `has_global_permission`. In a route that is `hasOrgPermission`, `authorizeOrgPermission`, or `hasGlobalPermission(…, "platform.manage")`. RLS enforces the same keys underneath.
- **Some organizer routes check the role name**, not a key: tournament create, edit, publish, close registration, cancel and participant export require an `owner` or `admin` membership of an **approved** organization (`authorizeTournamentManager` in `organizations/[orgId]/tournaments/[id]/_lib/authorize.ts`, or the same check inline). See the warning in [roles-and-permissions.md](./roles-and-permissions.md) §5.2.
- **Machine callers:** the CHIP webhooks verify an RSA signature, and the cron routes require `Authorization: Bearer $CRON_SECRET`.

---

## 2. Conventions

**Base URL:** `/api/v1`.

**Format:** JSON bodies. Instants are ISO 8601. Money is integer **sen** (`*_cents`). A tournament's calendar dates (`start_date`, `end_date`) are dates at the venue, in `tournaments.timezone`, and "today" for a tournament is today there (see [tournament-editing.md](./tournament-editing.md#stages)).

**Envelope:**

```json
// Success: most routes
{ "data": { ... } }

// Error: every route
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

A few routes answer success with a flat object instead of `data`: the signup steps and `/profile/oku` (`{ message }`), `PATCH /profile` (`{ success }`), `/tournaments/name-check` (`{ available }`) and `/feedback` (`{ reference }`). Check the route's tests before relying on a shape.

**No pagination or server-side filtering on public lists.** `GET /tournaments` returns every published tournament, ordered by start date, with live participant counts. The home page filters and searches it in the browser.

**Validation** is hand-written per route (no schema library), returning `400 VALIDATION_ERROR`, with `details[]` naming the fields where there is more than one (e.g. publish).

**Database errors are never shown to users.** `internalErrorResponse()` (`src/lib/http/internal-error.ts`) logs the real error and answers `500 INTERNAL_ERROR` with a generic message (#487).

**Notification emails go out after the response.** A route never waits for Resend: it schedules its `notify*` call with `afterResponse(task)` from `src/lib/http/after-response.ts`, which wraps Next's `after()` so the platform keeps the function alive until the email is sent. This also applies to emails sent from services a route calls (`settlePayout`, `fireRefund`, bank verification). When the reader would notice the order of emails, wrap the work in `inOrderAfterResponse(fn)`: every task `fn` schedules, at any depth, then runs one at a time in scheduling order. Examples are the admin payout review ("approved" before "processed") and cancellation approval (the cancellation notice before "refund completed"). The exceptions are emails whose result goes back to the user: verification codes, password resets, and member invitations (`email_sent`). In tests, the setup file holds `after()` callbacks until `runAfterCallbacks()` from `src/test/after.ts` is called.

**Routes that read email templates from disk** declare `export const runtime = "nodejs"`.

---

## 3. Endpoints

Paths are relative to `/api/v1`. "Signed in" means any authenticated user; a key in backticks is the permission checked on the organization in the path.

### Auth

| Method | Path | Who | What |
| -- | -- | -- | -- |
| POST | `/auth/signup/create-account` | Public | Create the account (`handle_new_user` creates `users` + `player_profiles`) and email a 6-character code. Rolls the account back if the code can't be stored or sent. |
| POST | `/auth/signup/verify-code` | Public | Check the code (15-minute TTL, attempt-limited), mark the account verified and sign in. |
| POST | `/auth/signup/request-code` | Public | Send a new code. Always a generic 200, so it can't be used to find accounts. |
| GET | `/auth/callback` | Public | Email-link landing: `verifyOtp` on `token_hash` + `type` (password recovery), then redirect to `next`. |

The verify step is gated by the `SIGNUP_STEP_COOKIE`. Details in [authentication-flow.md](./authentication-flow.md).

### Profile (the signed-in player)

| Method | Path | Who | What |
| -- | -- | -- | -- |
| GET, PATCH | `/profile` | Signed in | Read or update the player profile. DOB, gender, nationality, `fide_id` and `mcf_id` are set-once. A new `fide_id` is checked against FIDE and backfills ratings and title. |
| PATCH | `/profile/banking` | Signed in | Save or remove the player's bank account (prize payouts). Needs a current financial-data consent (`409 CONSENT_REQUIRED`). The full number is never returned. |
| POST | `/profile/consents` | Signed in | Record a grant of health or financial data consent (#451). Called before the OKU upload or a bank save. |
| POST, DELETE | `/profile/oku` | Signed in | Submit the uploaded OKU card for review (`oku_status = 'pending'`), or withdraw it, which deletes the files. |
| GET | `/me/registrations` | Signed in | The player's registrations with tournament, payment and live refund state. Runs the lazy payment-expiry sweep first. |
| POST | `/me/invitations/:id/accept` | Signed in (invitee) | Accept one of your own organization invitations, by id. |
| POST | `/me/invitations/:id/decline` | Signed in (invitee) | Decline one, by id. |

### Tournaments (public) and checkout

| Method | Path | Who | What |
| -- | -- | -- | -- |
| GET | `/tournaments` | Public | Every published tournament with participant counts (`get_participant_counts`). |
| GET | `/tournaments/:slug` | Public | One published tournament's details. |
| GET | `/tournaments/name-check` | Public | `?name=…&excludeId=…`: whether a tournament name is free (wizard). |
| POST | `/tournaments/:slug/checkout` | Signed in | **The only register-and-pay entry point.** Checks deadline, eligibility, fee tier, capacity and the prize-pool gate; creates or resumes the registration and its payment attempt; returns `{ data: { checkout_url, items: [{ registration_id }] } }`. A zero-fee tier confirms without CHIP and returns `redirect_url` (the confirmation page) in place of `checkout_url`. `items` holds one entry per registration in the purchase; today that is always one (#513). See [payment-flow.md](./payment-flow.md). |

There is no player cancellation route yet (#509).

### Invitations (by link)

| Method | Path | Who | What |
| -- | -- | -- | -- |
| POST | `/invitations/:token/accept` | Signed in as the invited address | Accept: inserts the membership with the offered role. |
| POST | `/invitations/:token/decline` | Anyone with the link | Decline. No account needed. |

Only the token's SHA-256 is stored. Invitations expire 30 days after they were sent.

### Organizations

| Method | Path | Who | What |
| -- | -- | -- | -- |
| GET, POST | `/organizations/applications` | Signed in | List your own applications, or apply. Apply creates the organization (pending), its bank account, KYB documents and agreement stamp in one transaction (`create_organization_application`). |
| GET | `/organizations/search` | Signed in | Approved organizations by name (id + name), for picking a payout beneficiary. |
| PATCH | `/organizations/:orgId` | `org.manage` | Edit the organization profile. |
| GET | `/organizations/:orgId/dashboard` | Member of an approved org | Dashboard stats, tournaments, agreement and bank-account notices. |
| POST | `/organizations/:orgId/agreement` | `org.manage` | Accept the current Organizer Agreement version. |
| GET, PUT | `/organizations/:orgId/bank-account` | `bank_account.manage` | Masked payout account, or replace it (supersedes the row; re-verified with CHIP Send). |
| GET | `/organizations/:orgId/members` | Member of an approved org | Members with roles. |
| POST | `/organizations/:orgId/members/invite` | `org.invite` | Invite by email with a role (`admin`/`member`). Creates an invitation, grants nothing. |
| PATCH, DELETE | `/organizations/:orgId/members/:id` | `org.manage` | Change a member's role, or remove them. Not yourself, never `owner`. |
| GET | `/organizations/:orgId/invitations` | `org.invite` | Pending and unanswered expired invitations. |
| DELETE | `/organizations/:orgId/invitations/:id` | `org.invite` | Revoke one. Re-inviting the address resends it. |

### Organizer tournaments

| Method | Path | Who | What |
| -- | -- | -- | -- |
| POST | `/organizations/:orgId/tournaments` | Owner/admin | Create a draft. |
| GET, PATCH | `/organizations/:orgId/tournaments/:id` | Owner/admin | Read for editing, or update. What may change depends on the stage: [tournament-editing.md](./tournament-editing.md). |
| POST | `/organizations/:orgId/tournaments/:id/publish` | Owner/admin | Validate and publish a draft (slug on first publish). A platform-distributed prize pool goes to `pending_funding` instead. |
| POST | `/organizations/:orgId/tournaments/:id/close-registration` | Owner/admin | Close registration now. Irreversible. |
| POST | `/organizations/:orgId/tournaments/:id/cancel` | Owner/admin | File a cancellation request with a reason. A platform admin approves it. |
| GET | `/organizations/:orgId/tournaments/:id/participants/export` | Owner/admin | `?format=csv\|xlsx`: the roster for pairing software (#90). |
| PUT | `/organizations/:orgId/tournaments/:id/beneficiary` | `payout.request` | Nominate another organization to receive the payout, or withdraw (`null`). |
| GET, PUT | `/organizations/:orgId/tournaments/:id/prize-funder-contacts` | `tournament.view` / `tournament.edit` | Sponsors' email addresses for a platform-distributed pool (kept out of the public `prizes` document). |
| GET, POST | `/organizations/:orgId/tournaments/:id/prize-funding` | `payout.view` / `payout.request` | The pool's funding position, or retry the sponsor links. |
| GET, POST | `/organizations/:orgId/tournaments/:id/prize-awards` | `payout.view` / `payout.request` | List awards, or enter a winner (from the last day of play). |

### Organizer payouts

| Method | Path | Who | What |
| -- | -- | -- | -- |
| GET, POST | `/organizations/:orgId/payouts` | `payout.view` / `payout.request` | Per-tournament payout position and history (including as beneficiary), or request an early payout. |
| GET | `/organizations/:orgId/nominations` | `payout.request` | Payout nominations waiting on this organization. |
| POST, DELETE | `/organizations/:orgId/nominations/:tournamentId` | `payout.request` | Accept or decline a nomination. |

### Admin (`platform.manage`)

| Method | Path | What |
| -- | -- | -- |
| GET | `/admin/dashboard` | Platform stats (users, organizations, tournaments, registrations, platform fees), recent tournaments, and the stuck-refund count. |
| GET | `/admin/applications` | Organizer applications. |
| GET, PATCH | `/admin/applications/:id` | One application (last 4 of the account, signed document URLs), or approve/reject it. Approval creates the owner membership. |
| PATCH | `/admin/oku/:userId` | Approve or reject a pending OKU verification. |
| PATCH | `/admin/tournament-cancellations/:id` | Approve (cancels, queues a refund per paid player) or reject a cancellation request. |
| GET | `/admin/refunds` | Refunds stuck in `pending`. |
| POST | `/admin/refunds/:id/refire` | Retry one, reconciling with CHIP first. |
| GET, POST | `/admin/payouts` | The payout queue and what could be paid now, or queue and send a payout. |
| PATCH | `/admin/payouts/:id` | Approve or reject an early payout request. |
| POST | `/admin/payouts/:id/send` | Retry sending an approved payout. |
| GET | `/admin/prize-awards` | Prize awards across tournaments. |
| PATCH | `/admin/prize-awards/:id` | Approve or reject an award. |
| POST | `/admin/prize-awards/:id/send` | Retry sending an approved award. |

Admin **pages** with no route of their own read through the server (e.g. `/admin/tournaments/[id]`, the read-only manage view, #557). There is no tournaments list, transactions or users API (#110).

### Feedback

| Method | Path | Who | What |
| -- | -- | -- | -- |
| POST | `/feedback` | Public (tighter limit signed out) | In-app bug report (#616). Saved to `bug_reports`, then filed as a GitHub issue on the public repo labelled `bug` + `user-reported`, without the reporter's identity. |

### Changelog

| Method | Path | Who | What |
| -- | -- | -- | -- |
| GET | `/changelog` | Public | `?after=v0.10.0-alpha`: the releases after that one that this build carries, newest first, from the cached GitHub release notes (#640). Used by the "What's new" dialog. 503 when GitHub can't be read. |

### Webhooks and crons (machine callers)

| Method | Path | Auth | What |
| -- | -- | -- | -- |
| POST | `/webhooks/chip` | RSA-SHA256 `X-Signature` (`CHIP_WEBHOOK_PUBLIC_KEY`) | CHIP Collect: registration payments, sponsor prize-pool payments, refunds. |
| POST | `/webhooks/chip/send` | RSA-SHA512 `X-Signature` (`CHIP_SEND_WEBHOOK_PUBLIC_KEY`) | CHIP Send: bank account verdicts, budget allocations, payout and prize-award transfers. |
| POST | `/webhooks/github` | HMAC-SHA256 `X-Hub-Signature-256` (`GITHUB_WEBHOOK_SECRET`) | GitHub release events: invalidate the cached changelog (#640). |
| POST | `/cron/refunds` | `CRON_SECRET` | Fire queued cancellation refunds. Every 5 minutes (`.github/workflows/cancellation-refunds.yml`). |
| POST | `/cron/payouts` | `CRON_SECRET` | Bank registrations, payout and prize sweeps. Daily at 01:00 UTC (`organizer-payouts.yml`). |
| POST | `/cron/fide-ratings` | `CRON_SECRET` | Refresh every player's FIDE ratings. Monthly (`fide-ratings.yml`). |
| POST | `/cron/audit-logs` | `CRON_SECRET` | Prune audit rows past retention; a dry run unless `AUDIT_LOG_PRUNE=delete`. Daily at 02:30 UTC (`audit-log-retention.yml`). |

---

## 4. Errors

Every error has the `{ "error": { "code", "message", "details"? } }` shape. The common codes:

| HTTP | Code | When |
| -- | -- | -- |
| 400 | `VALIDATION_ERROR` | The request fails validation |
| 400 | `INVALID_JSON` | The body isn't JSON |
| 401 | `UNAUTHORIZED` | No session |
| 403 | `FORBIDDEN` | Missing role or permission, or the organization isn't approved |
| 403 | `FORBIDDEN_ORIGIN` | A write or preflight from an origin the API doesn't allow ([§6](#6-cors-and-origin-policy)) |
| 404 | `NOT_FOUND` | No such resource, or not visible to the caller |
| 409 | `CONFLICT` | State conflict (e.g. a locked field changed, a duplicate) |
| 429 | `RATE_LIMITED` | Over a rate limit ([§5](#5-rate-limiting)) |
| 500 | `INTERNAL_ERROR` | Anything unexpected; details are logged, never returned |

Domain-specific codes are returned where the UI acts on them, for example `ALREADY_REGISTERED`, `CAPACITY_FULL`, `REGISTRATION_CLOSED`, `ELIGIBILITY_ERROR`, `INVALID_FEE_TIER`, `PAYMENT_IN_PROGRESS` (409, with `unlock_at`), `PRIZE_POOL_NOT_FUNDED` (422) and `PAYMENT_GATEWAY_ERROR` (503) at checkout; `EMAIL_EXISTS`, `CODE_INVALID`, `CODE_EXPIRED` and `TOO_MANY_ATTEMPTS` at signup; `CONSENT_REQUIRED`, `BANK_ACCOUNT_IN_USE` and `NAME_TAKEN` elsewhere. Grep the route for the full set.

---

## 5. Rate limiting

Every limit lives in `src/services/rate-limit/limits.ts` (#613). A rule counts each request in a fixed window (Upstash Redis) against every bucket that applies: per user, per client IP, and/or per IP only when signed out. A request over any bucket gets:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 480
```

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "You've tried to register several times in a short time. Please try again in 8 minutes.",
    "retry_after": 480
  }
}
```

The message is written for the user and the UI shows it as is.

| Rule                   | Routes                                                                                  | Window | Per user | Per IP              |
| ---------------------- | --------------------------------------------------------------------------------------- | ------ | -------- | ------------------- |
| `api` (baseline)       | every `/api` route, in `src/proxy.ts`, signed-in only                                   | 1 min  | 120      | —                   |
| `signup`               | `POST /auth/signup/create-account`, `/request-code`                                     | 10 min | —        | 30                  |
| `memberInvite`         | `POST /organizations/:orgId/members/invite`                                             | 1 h    | 30       | 60                  |
| `funderLinks`          | `PUT .../prize-funder-contacts` (only when it sends links), `POST .../prize-funding`    | 1 h    | 30       | 60                  |
| `payoutNomination`     | `PUT .../tournaments/:id/beneficiary`                                                   | 1 h    | 20       | 40                  |
| `checkout`             | `POST /tournaments/:slug/checkout`                                                      | 10 min | 10       | 30                  |
| `fideLookup`           | `PATCH /profile` with a new `fide_id`                                                   | 1 h    | 10       | —                   |
| `profileSave`          | `PATCH /profile`                                                                        | 10 min | 30       | —                   |
| `organizationSave`     | `PATCH /organizations/:orgId`                                                           | 10 min | 30       | —                   |
| `okuDocument`          | `POST /profile/oku`                                                                     | 1 day  | 5        | —                   |
| `organizerApplication` | `POST /organizations/applications`                                                      | 1 day  | 5        | 10                  |
| `feedback`             | `POST /feedback`                                                                        | 1 h    | 5        | 10 (3 signed out)   |

- **Exempt:** `/api/v1/webhooks/*` (CHIP) and `/api/v1/cron/*` (`CRON_SECRET`).
- **Redis down:** requests go through and the failure is logged to Sentry, except `signup` and `feedback`, which fail closed with a 500.
- **Client IP** comes only from `x-nf-client-connection-ip`, which Netlify sets (`src/lib/http/request-ip.ts`). `cf-connecting-ip` and `x-forwarded-for` are client-supplied on Netlify and ignored. Without the header, per-IP buckets are skipped, never shared.
- **No signed-out baseline:** server components fetch the app's own API from the server's address (e.g. the home page's tournament list), so an IP-keyed baseline would throttle every visitor together.
- The per-email auth counters (login lockout, verify-code attempts, resend cooldown) use the same primitive, in `src/services/rate-limit/auth.ts`, but answer with their own UX rather than this 429.

---

## 6. CORS and origin policy

Every `/api` route authenticates with the Supabase session cookies, which the browser attaches wherever the calling page came from. The proxy (`src/proxy.ts`, policy in `src/lib/http/origin-policy.ts`, #614) runs this check before any session work:

| Request                             | From an allowed origin                                                               | From any other origin                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `POST` / `PUT` / `PATCH` / `DELETE` | Goes to the route                                                                    | `403 FORBIDDEN_ORIGIN`                                 |
| `OPTIONS` preflight                 | `204` with the exact origin, credentials, methods and `Content-Type`; 10 min cache   | `403`, no CORS headers                                 |
| `GET` / `HEAD`                      | Goes to the route; on another host, gets `Access-Control-Allow-Origin` + credentials | Goes to the route; the browser can't read the response |

**Allowed origins:**

- **The origin serving the request**: scheme, host and port, as `resolveRequestOrigin` reads them (`x-forwarded-host`, else `host`; `x-forwarded-proto`, else `http` for loopback and `https` otherwise). This is plain same-origin traffic, and it is what makes deploy previews, branch deploys and a dev server on any port work. `http://` on our own hostname is a different origin and is refused, so a page injected over plain HTTP can't pass as us.
- **`NEXT_PUBLIC_SITE_URL`** and its **admin subdomain**: `www.mychesstour.com` → `admin.mychesstour.com`, `staging.mychesstour.com` → `admin.staging.mychesstour.com`.

Deploy previews are not trusted to call _another_ deployment's API. The repo is public and previews build pull-request code.

**How the origin is read:** `Origin`, else the origin of `Referer`. `Origin: null` (sandboxed frames, some cross-site redirects) and an unparseable `Referer` are refused. A write with neither header isn't from a browser, so there is no session for a page to ride, and it goes through to the route's own auth.

`Access-Control-Allow-Origin` is never `*`. Every API response carries `Vary: Origin`.

**Exempt:** `/api/v1/webhooks/*` (CHIP RSA signature) and `/api/v1/cron/*` (`CRON_SECRET`). Servers call them, with no browser origin. Pages are not covered here either: server actions get Next's own origin check.

**How this fits with `SameSite`:** the Supabase auth cookies use the `@supabase/ssr` default, `SameSite=Lax` (the app never overrides it; the session-only marker and signup cookies are `Lax` too). Lax already keeps the cookies off cross-_site_ subrequests, including a form POST from another registrable domain, so most cross-site writes would arrive signed out. The origin check covers what Lax doesn't:

- **Same-site, cross-origin** pages: another subdomain of `mychesstour.com` counts as the same site, so Lax sends the cookies.
- **Top-level `GET` navigations**, which Lax allows. The API must not change state on `GET`; that is a convention the routes follow, not something this check enforces.
- Browsers with older or no `SameSite` support.

The two layers are independent; neither is relied on alone.
