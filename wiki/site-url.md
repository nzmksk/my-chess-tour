# Site URL: public links vs. internal API calls

The app builds absolute URLs for two different jobs, and each one needs a different source for the origin:

| Job                                                               | Who follows the URL                     | Origin comes from                              |
| ----------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| **Outbound link**: an email, a password reset, a payment redirect | A person, later, from outside the app   | `NEXT_PUBLIC_SITE_URL`                         |
| **Internal API call**: a server component fetching `/api/v1/...`  | This server, during the current request | The incoming request (`src/lib/http/self-fetch.ts`) |

Using the wrong source in either case is a bug. Each mistake shows up differently.

## `NEXT_PUBLIC_SITE_URL`: the canonical public address

It is set per environment and stored verbatim on Netlify:

| Env file          | Value                             |
| ----------------- | --------------------------------- |
| `.env.production` | `https://www.mychesstour.com`     |
| `.env.staging`    | `https://staging.mychesstour.com` |
| `.env.local`      | `http://localhost:3000`           |

Use it whenever the URL leaves the request and someone follows it later. The request's own host is wrong for that job: it could be a deploy-preview hostname, an internal proxy host or `*.netlify.app` (which `netlify.toml` 301-redirects anyway). None of those should end up in a user's inbox or in a payment provider's records.

Current uses:

| Where                                                            | URL built                                                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/services/email/email.ts`, `sendTournamentCancellationEmail` | `{{browseUrl}}` → `/tournaments`                                                                                      |
| `src/services/email/email.ts`, `sendCancellationReviewEmail`     | Dashboard link → `/my/organizations`                                                                                  |
| `src/app/auth/forgot-password/_actions/forgotPassword.ts`        | Reset link → `/api/v1/auth/callback?token_hash=…&type=recovery&next=/auth/update-password`                            |
| `src/app/api/v1/tournaments/[slug]/checkout/route.ts`            | CHIP `success_redirect` / `failure_redirect` / `cancel_redirect` → `/tournaments/{slug}/register[/success\|/failure]` |

Payment _status_ never depends on this value. It arrives through the CHIP account webhook (`/api/v1/webhooks/chip`), which is configured in the CHIP dashboard, not per purchase. See [payment-flow.md](./payment-flow.md) and [chip-webhook.md](./chip-webhook.md).

Every call site falls back to `http://localhost:3000` when the variable is unset, so a missing value never produces a link starting with `undefined/`.

## Internal API calls: `selfApiFetch`

A server component that calls the app's own API must reach **the build that is rendering it**. `NEXT_PUBLIC_SITE_URL` names the canonical deployment, which is a different build whenever the page is served from:

- a Netlify **branch deploy or deploy preview** (the variable still says `https://staging.mychesstour.com`)
- a **dev server on a port other than 3000**
- any future multi-host setup

When the origins differ, the page silently reads the other build's API. If that build is older, newer fields are simply missing, and the page renders as though they were empty.

**The incident that prompted this:** the organizer dashboard banner ("No payout bank account") showed for an org whose bank account was _pending verification_. The org settings page queried Supabase directly and showed the right status. The dashboard fetched `https://staging.mychesstour.com/api/v1/organizations/{id}/dashboard`, and staging was running code from before `bank_account` was added to that payload. Both builds share the staging Supabase project, so the data was there; only the API code was stale.

### Usage

```ts
import { selfApiFetch } from "@/lib/http/self-fetch";

const res = await selfApiFetch(`/api/v1/organizations/${orgId}/dashboard`);
```

`selfApiFetch(path, init?)`:

- resolves the origin with `resolveRequestOrigin(await headers())`
- forwards the caller's `cookie` header, so the route sees the same session
- always sends `cache: "no-store"`

`resolveRequestOrigin(headers)`:

1. Host: `x-forwarded-host`, else `host` (first entry if comma-separated).
2. Protocol: `x-forwarded-proto`, else `http` for loopback hosts (`localhost`, `127.0.0.1`, `[::1]`, any port) and `https` otherwise.
3. If there is no host header at all, falls back to `NEXT_PUBLIC_SITE_URL`, then `http://localhost:3000`.

Current callers:

- `src/app/my/organizations/[orgId]/page.tsx`: dashboard data
- `src/app/my/organizations/[orgId]/tournaments/create/page.tsx`: org lookup
- `src/app/my/organizations/[orgId]/tournaments/[id]/edit/page.tsx`: tournament and org name

Tests: `src/lib/__tests__/self-fetch.test.ts`.

## Rule of thumb

> Will a person or a third party follow this URL after the current request ends? → `NEXT_PUBLIC_SITE_URL`.
> Is this server calling itself right now? → `selfApiFetch`.

Do not write a new `fetch(\`${process.env.NEXT_PUBLIC_SITE_URL}/api/...\`)` in a server component.

A consequence worth knowing when testing: on a branch deploy or deploy preview, outbound links still point at staging. A CHIP payment started on a preview redirects back to `staging.mychesstour.com`, and an email sent from one links to staging. That is expected; to test the full round trip, use staging itself.
