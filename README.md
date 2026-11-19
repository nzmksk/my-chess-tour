# MY Chess Tour

A platform for chess tournaments in Malaysia. Organizers list their events, players find them, register and pay online (FPX, DuitNow QR, e-wallets and cards through CHIP), and the platform pays organizers out and, when it manages a sponsored prize pool, pays the winners.

- **Production:** https://www.mychesstour.com (`master`)
- **Staging:** https://staging.mychesstour.com (`staging`)
- **Where things stand before launch:** [wiki/launch-readiness.md](wiki/launch-readiness.md)

## Stack

| Layer           | What                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| App             | Next.js 16 (App Router, TypeScript), Tailwind CSS v4, React 19, Zustand                  |
| Database & auth | Supabase: Postgres (RLS, `SECURITY DEFINER` functions), Auth (email + password), Storage |
| Payments        | CHIP Collect (money in, refunds) and CHIP Send (payouts, prizes)                         |
| Email           | Resend, with HTML templates in `src/services/email/templates/`                           |
| Rate limits     | Upstash Redis                                                                            |
| Monitoring      | Sentry (inert until a DSN is set)                                                        |
| Hosting         | Netlify (`next build` / `next start`); scheduled jobs are GitHub Actions                 |

> **Next.js 16 differs from older versions** (`src/proxy.ts` replaces `middleware.ts`, among other changes). Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code. See [AGENTS.md](AGENTS.md).

## Getting started

**Prerequisites:** Node 24 and npm. Docker and `psql` only if you want to run the SQL test suites locally.

```sh
npm ci
cp .env.example .env.local   # then fill it in (below)
npm run dev        # http://localhost:3000
```

### Environment

`.env*` files are git-ignored except [`.env.example`](.env.example): copy it to `.env.local` and get the values from a maintainer. Local development uses the **staging** Supabase project and CHIP's sandbox, so treat staging data as shared. Netlify holds each site's real values, stored verbatim: paste them without quotes.

| Variable                                                                                                        | Used for                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                                                                                          | Every link that leaves the request (emails, CHIP redirects). `http://localhost:3000` locally. See [wiki/site-url.md](wiki/site-url.md) |
| `NEXT_PUBLIC_ENVIRONMENT`                                                                                       | `production` / `staging` / `development`; the footer and bug reports show it                                                           |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLIC_KEY`                                                   | Supabase project and its publishable key                                                                                               |
| `SUPABASE_SECRET_KEY`                                                                                           | Service-role key, server only. Bypasses RLS                                                                                            |
| `CHIP_API_KEY`, `CHIP_BRAND_ID`, `CHIP_WEBHOOK_PUBLIC_KEY`                                                      | CHIP Collect and its webhook signature                                                                                                 |
| `CHIP_SEND_API_URL`, `CHIP_SEND_API_KEY`, `CHIP_SEND_API_SECRET`, `CHIP_SEND_WEBHOOK_PUBLIC_KEY`                | CHIP Send (payouts and prizes) and its webhook signature                                                                               |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`                                                                           | Sending email                                                                                                                          |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`                                                            | Signup codes, login lockout, API rate limits                                                                                           |
| `CRON_SECRET`                                                                                                   | Bearer token the scheduled jobs send to `/api/v1/cron/*`                                                                               |
| `GITHUB_TOKEN`                                                                                                  | Filing in-app bug reports as GitHub issues                                                                                             |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Optional. Leave the DSN unset locally and nothing is sent. See [wiki/error-monitoring.md](wiki/error-monitoring.md)                    |

`NEXT_PUBLIC_*` values are inlined at build time, so changing one on Netlify needs a redeploy.

### Local quirks

- **CHIP webhooks can't reach localhost.** A local checkout still completes: the success and failure pages read the purchase from CHIP and settle it through the same database function the webhook uses.
- **Per-IP rate limits are skipped locally.** The client IP comes only from Netlify's `x-nf-client-connection-ip` header; per-user limits still apply.
- **Outbound links use `NEXT_PUBLIC_SITE_URL`**, so an email sent from a branch deploy links to staging. Test full round trips on staging itself.

## Scripts

| Command                        | What                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `npm run dev`                  | Dev server                                                                                           |
| `npm run build`                | Production build (also resolves the release version from git tags)                                   |
| `npm run lint`                 | ESLint (CI runs it with `--max-warnings 0`)                                                          |
| `npm run test`                 | Vitest, once                                                                                         |
| `npm run test:watch`           | Vitest in watch mode                                                                                 |
| `npm run test:coverage`        | Vitest with coverage (what CI runs)                                                                  |
| `npx knip`                     | Unused files, exports and dependencies                                                               |
| `npx prettier --write <files>` | Format. The repo isn't fully Prettier-clean, so format the files you touch rather than whole folders |

## Project layout

```
src/
  app/               Pages and API routes (App Router)
    api/v1/          The HTTP API, see wiki/api-design.md
    admin/           Platform admin pages
    my/              Signed-in player and organizer dashboards
    tournaments/     Tournament detail, registration and checkout pages
  components/        Shared UI (components/ui: Radix/shadcn primitives)
  services/          Server-side integrations: supabase, chip, email, payouts,
                     prizes, refunds, rate-limit, fide, sentry, ...
  lib/               Framework-agnostic helpers (may not import app, components or stores)
  stores/            Zustand stores
  content/           The user-facing changelog
  styles/globals.css Design tokens and component classes
  proxy.ts           Session refresh, route protection, rate limits, origin policy
supabase/
  migrations/        Append-only schema history (Supabase CLI)
  tests/             SQL regression suites and run.sh
  staging/           Seed data and staging-only scripts (never run on production)
wiki/                Design docs and runbooks (index below)
.github/workflows/   CI, staging migrations and the scheduled jobs
```

## Conventions worth knowing first

- **Reading the user on the server:** `getAuthClaims()` from `@/services/supabase/permission`. It returns the `public.users.id` as `id`, which is not the Supabase Auth id. Avoid `getUser()` except where an immediate revocation check matters (checkout). See [wiki/authentication-flow.md](wiki/authentication-flow.md).
- **Authorization is data-driven:** roles map to permission keys, checked with `hasOrgPermission` / `hasGlobalPermission` and enforced again by RLS. See [wiki/roles-and-permissions.md](wiki/roles-and-permissions.md).
- **Money state lives in Postgres.** Payments, refunds, payouts and prizes change state only through `SECURITY DEFINER` functions with row locks, and every settlement is idempotent. Calls to CHIP happen outside those transactions. Read the flow doc before touching one.
- **Never show a database error to a user.** Return `internalErrorResponse()` from `@/lib/http/internal-error`; ESLint enforces this.
- **Emails go out after the response**, through `afterResponse()` / `inOrderAfterResponse()` in `@/lib/http/after-response`.
- **Dates:** a tournament's dates and "today" are in the venue's timezone (`tournaments.timezone`), never the server's.
- **Schema changes are new migration files.** Never edit one that has been applied. See [wiki/database-migrations.md](wiki/database-migrations.md).
- **A new sensitive column** must be added to `redact_audit_snapshot()` in the same PR.

## Testing

- **Unit and route tests:** Vitest with jsdom, in `__tests__/` folders next to the code. They mock Supabase and CHIP, so they don't reach the SQL.
- **Database tests:** `supabase/tests/*.sql`, the safety net for the money paths. CI builds a database from `supabase/migrations` and runs them all. To run them locally, see [wiki/database-migrations.md](wiki/database-migrations.md#tests).
- **CI** (`.github/workflows/tests.yml`) runs lint, Vitest with coverage and the SQL suites on every PR into `staging` or `master`. It also fails if a release tag has no changelog entry.
- **Manual CHIP scenarios** to run before a release are in [wiki/payment-flow.md](wiki/payment-flow.md#c-end-to-end-manual-chip-sandbox).

## Branches, deploys and releases

1. Branch from `staging`, named after the issue (`633-automate-db-tests`), and reference the issue in commit messages (`… (#633)`).
2. Open a PR into `staging`; it is squash-merged once CI is green.
3. A merge to `staging` deploys the staging site and applies any new migrations to the staging database.
4. To release: add the changelog entry, tag a pre-release on `staging`, migrate production's database by hand, then **merge** (not squash) `staging` into `master`. Step by step: [wiki/releases.md](wiki/releases.md).

## Scheduled jobs

There is no `pg_cron` and no Netlify scheduler. Each job is a GitHub Actions workflow that POSTs a cron route with `Authorization: Bearer $CRON_SECRET`. GitHub cron is always UTC; Malaysia is UTC+8.

| Job                  | Workflow                   | Schedule (UTC) | Frequency                                 | Route (time limit)                  | What it does                                                                                                                                                                                                                                                                              |
| -------------------- | -------------------------- | -------------- | ----------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancellation refunds | `cancellation-refunds.yml` | `*/5 * * * *`  | Every 5 minutes                           | `/api/v1/cron/refunds` (60 s)       | Sends the refunds an approved cancellation queued to CHIP. Each call fires a time-boxed chunk; the workflow keeps calling while the route answers `more: true`, up to 40 calls a run, and the next run picks up the rest. See [refund-flow.md](wiki/refund-flow.md#the-refund-sweep-496). |
| Payouts and prizes   | `organizer-payouts.yml`    | `0 1 * * *`    | Daily, 01:00 UTC (09:00 MYT)              | `/api/v1/cron/payouts` (300 s)      | Re-registers bank accounts still waiting on a CHIP Send verdict, settles stuck payouts, retries pending ones, pays every tournament 3 days past its end, then the same passes for prize awards and sponsor funding links. See [payout-flow.md](wiki/payout-flow.md#the-daily-run).        |
| FIDE ratings         | `fide-ratings.yml`         | `0 0 2 * *`    | Monthly, the 2nd at 00:00 UTC (08:00 MYT) | `/api/v1/cron/fide-ratings` (300 s) | Refreshes every player's FIDE ratings and title after FIDE publishes its monthly list.                                                                                                                                                                                                    |

- **Production only.** All three call `PRODUCTION_URL` (a repository secret), so staging runs nothing on a schedule. To exercise a job on staging, call its route yourself:
  ```sh
  curl -fsS -X POST -H "Authorization: Bearer $STAGING_CRON_SECRET" \
    https://staging.mychesstour.com/api/v1/cron/refunds   # or /payouts, /fide-ratings
  ```
- **On demand:** every workflow also has **Run workflow** in the Actions tab. All three are safe to re-run or overlap: each refund, payout and award is claimed under a row lock, and CHIP dedupes on our reference.
- **Timing is best effort.** GitHub can start a scheduled run late under load, and it runs schedules from the default branch (`staging`). In a public repository it also disables scheduled workflows after 60 days without commits; re-enable them from the Actions tab if that happens.
- **Not scheduled:** expiring abandoned checkouts happens lazily when the data is read ([payment-flow.md](wiki/payment-flow.md#expiry-no-chip-event)), and nothing prunes `audit_logs` yet (#507).

## Pre-launch checklists

These assume nothing is configured yet: no services, no Netlify variables, no GitHub secrets. Do staging first; production repeats most of it with live credentials. The details live in the linked pages. The product-level checklist (flows to test, decisions still open) is §10 of [launch-readiness.md](wiki/launch-readiness.md).

Netlify stores values verbatim: paste every value **without quotes**, and PEM keys as raw multi-line text. Generate each `CRON_SECRET` with `openssl rand -hex 32`, separately per environment.

### Staging

**Services**

- [ ] **Supabase** project for staging, Postgres 16 or later (the QA role needs it). Auth → JWT signing keys must be **asymmetric**, which is what lets the proxy and `getAuthClaims()` verify sessions locally. The app sends its own signup and password-reset emails through Resend, so Supabase's email templates aren't used.
- [ ] **Upstash Redis** database for staging.
- [ ] **Resend:** verify the sending domain and choose `RESEND_FROM_EMAIL`.
- [ ] **CHIP Collect (sandbox):** API key and brand id. Under Developers → Webhooks, add `https://staging.mychesstour.com/api/v1/webhooks/chip` subscribed to `purchase.paid`, `purchase.captured`, `purchase.payment_failure`, `purchase.cancelled`, `payment.refunded`, `purchase.refund_failure` and `purchase.pending_refund`. Copy **that webhook's** public key (not the account key) into `CHIP_WEBHOOK_PUBLIC_KEY`. See [chip-webhook.md](wiki/chip-webhook.md).
- [ ] **CHIP Send (sandbox,** `CHIP_SEND_API_URL=https://staging-api.chip-in.asia/api`**):** API key and secret. Register the webhook with `POST /webhooks` (callback `https://staging.mychesstour.com/api/v1/webhooks/chip/send`, hooks `bank_account_status`, `send_instruction_status`, `budget_allocation_status`). `source chip_send.sh` gives you a signed `chip_send` helper for it. Copy the returned `public_key` into `CHIP_SEND_WEBHOOK_PUBLIC_KEY`.
- [ ] **GitHub token for bug reports:** fine-grained, this repository only, Issues read and write, as `GITHUB_TOKEN`. Create the `user-reported` label on the repo.
- [ ] **Sentry** (optional on staging, needed before launch): steps 1–7 of [error-monitoring.md](wiki/error-monitoring.md#setup).

**Netlify (staging site)**

- [ ] The site builds `staging` and serves `staging.mychesstour.com`.
- [ ] Every variable from [Environment](#environment), with `NEXT_PUBLIC_SITE_URL=https://staging.mychesstour.com`, `NEXT_PUBLIC_ENVIRONMENT=staging` and staging's own `CRON_SECRET`. Set `SENTRY_AUTH_TOKEN` to the Builds scope only.
- [ ] A release tag (`v…`) is reachable from `staging`. Without one the build fails ([releases.md](wiki/releases.md)).

**Database**

- [ ] GitHub → Settings → Environments → `staging` (deployment branch `staging` only), secret `STAGING_DATABASE_URL` set to the session pooler string with `?sslmode=require`. See [database-migrations.md](wiki/database-migrations.md#setup-admin-once).
- [ ] Apply the migrations: run **Staging database migrations** from the Actions tab.
- [ ] Optionally load test data with `supabase/staging/seed.sql`.
- [ ] Make yourself a platform admin after signing up:
  ```sql
  INSERT INTO user_global_roles (user_id, role_id)
  SELECT u.id, r.id FROM users u, roles r
  WHERE lower(u.email) = lower('<your email>') AND r.name = 'platform_admin';
  ```
- [ ] Optionally give QA read-only access: [staging-db-access.md](wiki/staging-db-access.md).

**Verify end to end**

The [scheduled jobs](#scheduled-jobs) only ever call production (`PRODUCTION_URL`), so on staging you trigger the cron routes by hand:

```sh
curl -fsS -X POST -H "Authorization: Bearer $STAGING_CRON_SECRET" \
  https://staging.mychesstour.com/api/v1/cron/refunds   # or /payouts, /fide-ratings
```

- [ ] Sign up → code email arrives → log in → reset the password.
- [ ] Apply as an organizer → approve in `/admin/applications` → the bank account turns verified (CHIP Send webhook).
- [ ] Create and publish a tournament, register and pay in the CHIP sandbox, and confirm the webhook settled it, not only the return page. Run the scenarios in [payment-flow.md](wiki/payment-flow.md#c-end-to-end-manual-chip-sandbox).
- [ ] Cancel a paid tournament → approve in `/admin/cancellations` → call `/cron/refunds` → the refund settles and the player is emailed.
- [ ] Payout: once a tournament is 3 days past its end, call `/cron/payouts` → send instruction → `paid` → email. Do the same for a platform-distributed prize award.
- [ ] A bug report from the site files an issue.
- [ ] Sentry: step 9 of [error-monitoring.md](wiki/error-monitoring.md#9-verify-on-staging).

### Production

**Services** (separate from staging's)

- [ ] **Supabase** project for production, with the same auth settings. No seed data and no QA role, ever.
- [ ] **Upstash** database, **Resend** sender (the same verified domain is fine) and **Sentry** (the same project; `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`).
- [ ] **CHIP Collect live** keys (#123) and a webhook to `https://www.mychesstour.com/api/v1/webhooks/chip` with the same events and its own public key.
- [ ] **CHIP Send production** (`CHIP_SEND_API_URL=https://api.chip-in.asia/api`), webhook registered to the production callback, and the Send balance funded with budget approvers in place.
- [ ] **Uptime monitor** on `https://www.mychesstour.com` (#572).

**Netlify (production site)**

- [ ] The site builds `master` and serves `www.mychesstour.com`.
- [ ] Every variable with production values, `NEXT_PUBLIC_SITE_URL=https://www.mychesstour.com`, `NEXT_PUBLIC_ENVIRONMENT=production` and its own `CRON_SECRET`.

**GitHub**

- [ ] Repository secrets for the scheduled jobs: `CRON_SECRET` (production's value) and `PRODUCTION_URL=https://www.mychesstour.com`.
- [ ] Optionally `CLAUDE_CODE_OAUTH_TOKEN` for `claude.yml`.

**Database**

- [ ] Migrate by hand, dry run first ([database-migrations.md](wiki/database-migrations.md#production), #161):
  ```sh
  npx supabase@2.122.1 db push --db-url "$PROD_DB_URL" --include-all --dry-run
  npx supabase@2.122.1 db push --db-url "$PROD_DB_URL" --include-all
  ```
- [ ] Grant the admin account `platform_admin` with the SQL above (#127).

**Go live**

- [ ] Add the changelog entry, tag the release on `staging`, then **merge** (not squash) `staging` into `master` ([releases.md](wiki/releases.md)).
- [ ] Run each scheduled workflow once from the Actions tab (refunds, payouts, FIDE ratings) and check it succeeds.
- [ ] Smoke-test with a real small payment, then refund it (#129).
- [ ] Sentry: repeat step 9.1 against production.
- [ ] Close the remaining items in [launch-readiness.md](wiki/launch-readiness.md#10-pre-launch-review-checklist) §10 (privacy wording review, the CHIP Send sandbox run, the one-time database rebuild).

## Docs

| Topic                                                           | Page                                                                                                                                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is built, partial or missing, and the pre-launch checklist | [launch-readiness.md](wiki/launch-readiness.md)                                                                                                                                                     |
| The original product spec                                       | [mvp.md](wiki/mvp.md)                                                                                                                                                                               |
| API routes, errors, rate limits, CORS                           | [api-design.md](wiki/api-design.md)                                                                                                                                                                 |
| Sessions and auth                                               | [authentication-flow.md](wiki/authentication-flow.md)                                                                                                                                               |
| Roles and permissions                                           | [roles-and-permissions.md](wiki/roles-and-permissions.md)                                                                                                                                           |
| Money: payments, refunds, payouts, prizes                       | [payment-flow.md](wiki/payment-flow.md), [refund-flow.md](wiki/refund-flow.md), [payout-flow.md](wiki/payout-flow.md), [prize-flow.md](wiki/prize-flow.md), [chip-webhook.md](wiki/chip-webhook.md) |
| Editing a tournament after publish                              | [tournament-editing.md](wiki/tournament-editing.md)                                                                                                                                                 |
| Database migrations and the SQL test suites                     | [database-migrations.md](wiki/database-migrations.md)                                                                                                                                               |
| Releases, the version and the changelog                         | [releases.md](wiki/releases.md)                                                                                                                                                                     |
| Public links vs internal API calls                              | [site-url.md](wiki/site-url.md)                                                                                                                                                                     |
| Error monitoring                                                | [error-monitoring.md](wiki/error-monitoring.md)                                                                                                                                                     |
| Account deletion runbook                                        | [account-deletion.md](wiki/account-deletion.md)                                                                                                                                                     |
| QA access to the staging database                               | [staging-db-access.md](wiki/staging-db-access.md)                                                                                                                                                   |
| Visual design                                                   | [design-system.md](wiki/design-system.md)                                                                                                                                                           |
