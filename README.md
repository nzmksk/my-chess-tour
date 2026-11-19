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
# create .env.local (below)
npm run dev        # http://localhost:3000
```

### Environment

`.env*` files are git-ignored. Get the values for `.env.local` from a maintainer. Local development uses the **staging** Supabase project and CHIP's sandbox, so treat staging data as shared. Netlify holds each site's real values, stored verbatim: paste them without quotes.

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

**Scheduled jobs** (GitHub Actions, calling `/api/v1/cron/*` with `CRON_SECRET`): cancellation refunds every 5 minutes, organizer payouts and prize sends daily at 01:00 UTC, FIDE ratings monthly.

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
