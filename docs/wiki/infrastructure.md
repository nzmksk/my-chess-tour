# Infrastructure and server locations

Every outside service the app or its tooling depends on, what each one is for, and where its servers are. Use this page when you set up a new environment, choose the region for a new service, or update the privacy policy's cross-border transfer wording (see [error-monitoring.md](./error-monitoring.md), "Still open").

Regions were read from each provider's dashboard or API on **2026-11-27** unless a row says otherwise. A region that couldn't be confirmed is marked **unconfirmed**. Don't fill it in from memory.

## Runtime services

The app calls these while serving requests.

| Service | Used for | Staging | Production | Env vars |
| -- | -- | -- | -- | -- |
| **Netlify** (Functions) | Hosts the Next.js app: server rendering, route handlers, `src/proxy.ts` | `us-east-2` (Ohio, US) | `us-east-2` (Ohio, US) | none in code; sites `staging-mychesstour`, `mychesstour` |
| **Supabase** | Postgres, Auth, Storage (including the private `oku-documents` bucket) | `ap-southeast-1` (Singapore), project `mychesstour-staging` | `ap-southeast-2` (Sydney, Australia), project `mychesstour` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLIC_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL` |
| **Upstash Redis** | Signup verification codes (15-minute expiry), rate limits | `ap-southeast-1` (Singapore), database `stirred-crane-91044` | **unconfirmed**: database `obliging-ghost-75666` belongs to an Upstash account the team account can't see | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **Resend** | Every email the app sends, including the auth emails (links come from `auth.admin.generateLink` and go out through Resend, not Supabase's mailer) | `ap-northeast-1` (Tokyo, Japan), domain `mychesstour.com` | Same domain and region | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| **CHIP Collect** | Registration and sponsor payments, plus the payment webhook | `gate.chip-in.asia` (shared host, sandbox keys) | `gate.chip-in.asia` | `CHIP_API_KEY`, `CHIP_BRAND_ID`, `CHIP_WEBHOOK_PUBLIC_KEY` |
| **CHIP Send** | Payouts, refunds and prize transfers, plus the payout webhook | `staging-api.chip-in.asia` | `api.chip-in.asia` | `CHIP_SEND_API_URL`, `CHIP_SEND_API_KEY`, `CHIP_SEND_API_SECRET`, `CHIP_SEND_WEBHOOK_PUBLIC_KEY` |
| **Sentry** | Error monitoring | US region (`us.sentry.io`) | US region | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
| **PostHog** | Product analytics (cookieless, never identifies users) | US Cloud (`us.i.posthog.com`), one project for both sites | US Cloud | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |
| **GitHub API** | Turns in-app bug reports into issues, reads releases for the changelog, receives the release webhook | US (github.com) | US | `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET` |
| **Lichess API** | FIDE player and rating lookups ([ADR 0029](../adr/0029-fide-players-come-from-the-lichess-api.md)), because Netlify can't reach ratings.fide.com | **unconfirmed** (public API, no account) | Same | none |

CHIP is a Malaysian provider, but it doesn't publish where its servers are. Ask CHIP before you write that location into the privacy policy.

## Build, CI and tooling

Nothing here handles user requests. Only the GitHub Actions jobs touch user data, and only through the app's own cron routes.

| Service | Used for | Location |
| -- | -- | -- |
| **GitHub Actions** | Tests (`tests.yml`), staging migrations (`staging-migrations.yml`), the scheduled cron calls, the staging redeploy on release (`release-deploy.yml`) | GitHub-hosted runners (US) |
| **Netlify build** | `next build`, triggered by a push or by the `NETLIFY_STAGING_BUILD_HOOK` build hook | Netlify build infrastructure |
| **Anthropic** (Claude Code Action) | `claude.yml` (PR and issue assistant) | US |
| **Google Fonts** | Cinzel and Lato through `next/font/google` | Downloaded at build time and served from our own domain, so visitors' browsers never call Google |

## Where personal data is stored

Users are mostly in Malaysia, but none of their data is stored there:

- **Australia:** the production database and file storage (profiles, registrations, payments, OKU documents, bank details).
- **Singapore:** staging data and the staging Redis. The production Redis is unconfirmed.
- **Japan:** email content and recipient addresses (Resend).
- **United States:** request processing (Netlify Functions), error events (Sentry), analytics events (PostHog).

The privacy policy currently lists only the US transfers (Sentry and PostHog). Section 7 still needs the Supabase, Netlify, Resend and Upstash entries. That's the open item in [error-monitoring.md](./error-monitoring.md).

## Known mismatches

- **Production database and app servers are on opposite sides of the Pacific.** The functions run in Ohio and the database is in Sydney, so every query from a server-rendered page or route handler pays a US–Australia round trip, often several per request. The two would ideally share a region. Decide whether to move the Netlify functions region (Site configuration → Functions; check whether the plan allows it) or the database. Moving the database means creating a new Supabase project and migrating to it.
- **Staging and production are in different Supabase regions** (Singapore and Sydney), so latency measured on staging won't match production.
- **The Resend region (Tokyo) matches neither database.** This matters less, because the email is sent once from the function and isn't on the page's critical path.

## How to re-check

| Service | Where the region is shown |
| -- | -- |
| Netlify | `netlify api listSites` → `functions_region`, or Site configuration → Functions |
| Supabase | Project settings → General → Region, or the Supabase MCP `list_projects` |
| Upstash | Console → database → Details → Region |
| Resend | Domains → domain → Region |
| Sentry | Organization settings → Data storage location (`us.sentry.io` means US) |
| PostHog | Project settings, or `api_host` in `project-get` (`us.i.posthog.com` means US Cloud) |

When a region changes, update this page and the privacy policy in the same PR.
