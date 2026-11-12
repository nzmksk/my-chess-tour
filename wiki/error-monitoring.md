# Error monitoring (Sentry)

How production and staging errors reach us, and the one-time setup that turns it on. Issue #125; [launch-readiness](./launch-readiness.md) S6.

The code is in place and does **nothing** until `NEXT_PUBLIC_SENTRY_DSN` is set in a site's environment. Everything under [Setup](#setup) is account and dashboard work: no code changes.

## What gets reported

| Source | How it reaches Sentry | Where |
| -- | -- | -- |
| Errors thrown in Server Components, Route Handlers, Server Actions, the proxy | `onRequestError` → `Sentry.captureRequestError` | `src/instrumentation.ts` |
| Handled failures logged with `console.error` (CHIP calls, refund settlement, payouts, webhook reconciliation, auth) | `captureConsoleIntegration({ levels: ["error"] })` | `src/services/sentry/server.ts` |
| Uncaught errors and unhandled promise rejections in the browser | Browser SDK global handlers | `src/instrumentation-client.ts` |
| Render errors caught by the root error boundary | `Sentry.captureException` in the boundary | `src/app/global-error.tsx` |

The `console.error` row matters most. Most failures in this app never throw: a route catches the error, logs it, and returns a 4xx/5xx. Without that integration none of them would show up. A `console.error` that includes an `Error` becomes an exception event with a stack trace; one without becomes a message event. Either way, every argument that was logged is attached as `extra.arguments`.

**Netlify flush.** Sentry sends events in the background and only forces a flush before the function freezes on Vercel and Cloudflare. `src/services/sentry/flush-after-response.ts` schedules `Sentry.flush()` with Next's `after()` for every captured event, so Netlify keeps the function alive until the event is sent. Step 9 below verifies this on real infrastructure. It is the one part that tests can't cover.

**Deliberately off:**

- **Session Replay.** It records what users see and type, which is PII, and it uses up the free quota.
- **Tracing / performance.** Also quota. Turning it on later only needs `tracesSampleRate` in `src/services/sentry/options.ts`.
- **`sendDefaultPii`.** No IP addresses, cookies, or request bodies are sent.
- **Ad-blocker tunnel (`tunnelRoute`).** Some browser events will be blocked by ad-blockers. A tunnel would route them through our own functions (more invocations), and the proxy matcher would have to exclude it. Revisit if browser coverage turns out to be poor.

## Environment variables

| Variable | Value | Production site | Staging site | Secret? |
| -- | -- | -- | -- | -- |
| `NEXT_PUBLIC_SENTRY_DSN` | Project DSN (step 3) | ✅ | ✅ (same DSN) | No: a DSN only allows *sending* events |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `production` / `staging` | `production` | `staging` | No |
| `SENTRY_AUTH_TOKEN` | Organization token (step 4) | ✅ | ✅ | **Yes** |
| `SENTRY_ORG` | Organization slug | ✅ | ✅ | No |
| `SENTRY_PROJECT` | Project slug | ✅ | ✅ | No |

- The two `NEXT_PUBLIC_` values are **inlined at build time**. Changing them requires a redeploy, not just a restart.
- Without `SENTRY_AUTH_TOKEN` the build skips source maps entirely (`next.config.ts`). Errors still report, but stack traces point at minified code.
- If `NEXT_PUBLIC_SENTRY_ENVIRONMENT` is unset, it falls back to `NODE_ENV`, which is `production` on both sites. Set it on staging so staging noise doesn't page anyone.
- Netlify stores values verbatim. Paste them **without quotes**.
- Locally: leave the DSN unset (the default) and nothing is sent. To test locally, put the DSN in `.env.local` with `NEXT_PUBLIC_SENTRY_ENVIRONMENT=development`.

## Setup

### 1. Create the Sentry organization

1. Sign up at sentry.io on the **Developer** (free) plan. Use a shared/ops mailbox rather than a personal one, so ownership survives people changes.
2. **Choose the data storage region.** This can't be changed later. Pick it deliberately, because it decides where error data, which may contain personal data, is stored. Record the choice in the privacy wording (step 8).
3. Name the organization (e.g. `my-chess-tour`). Its slug is `SENTRY_ORG`.

### 2. Create the project

1. **Projects → Create Project → Next.js.** Use the name `my-chess-tour`; the slug is `SENTRY_PROJECT`.
2. Alert frequency: choose **"Alert me on high priority issues"** for now (tuned in step 6).
3. **Skip the setup wizard** (`npx @sentry/wizard`). The SDK is already wired in, and the wizard would generate duplicate config files.

One project serves both sites. Staging and production are told apart by the `environment` tag.

### 3. Copy the DSN

**Settings → Projects → my-chess-tour → Client Keys (DSN)** → copy the DSN. On the same page, set a **rate limit** on the key (e.g. 100 events/minute). Then a single error loop can't burn the month's 5,000-error free quota in an hour.

### 4. Create the build token

**Settings → Developer Settings → Organization Tokens → Create New Token** (name: `netlify-build`). Organization tokens are scoped to source-map upload and release management, which is all the build needs. Copy it once; it's shown only at creation.

### 5. Configure Netlify (both sites)

For the **production** site, then the **staging** site: **Site configuration → Environment variables → Add a variable**, using the table above.

- `SENTRY_AUTH_TOKEN`: tick **"Contains secret values"** and set the scope to **Builds** only. Nothing at runtime needs it.
- Everything else: all scopes.

Then **Deploys → Trigger deploy → Clear cache and deploy site** on each site. The build log should show `Running next.config.js provided runAfterProductionCompile` followed by a source-map upload. In Sentry, **Settings → Projects → my-chess-tour → Source Maps** should list an artifact bundle for the release.

### 6. Alerts

**Alerts → Create Alert → Issues**:

1. **Production, new issue.** Environment `production`; when *a new issue is created*; notify by email (the ops mailbox, or the on-call person).
2. **Production, regression.** Environment `production`; when *an issue changes state from resolved to unresolved*.
3. Edit the default alert created in step 2 and filter it to `environment:production`, so staging doesn't email anyone. Staging issues are still visible in the Issues list.

If a team chat is used for ops, add it under **Settings → Integrations** and route the production alerts there as well as email.

### 7. Privacy and noise settings

**Settings → Projects → my-chess-tour → Security & Privacy:**

- **Data Scrubber:** on. **Use Default Scrubbers:** on.
- **Prevent Storing of IP Addresses:** on.
- **Additional Sensitive Fields:** add the columns that can appear in a logged Supabase error or request payload:

  ```
  account_number
  bank_account_number
  bank_account_holder
  account_holder
  date_of_birth
  dob
  phone
  oku_status
  oku_rejection_reason
  oku_document_path
  ```

  This matters because `captureConsoleIntegration` attaches the full logged arguments, and a Postgres error's `details` can quote row values. Scrubbing runs on Sentry's side before storage.

**Settings → Projects → my-chess-tour → Inbound Filters:** enable *browser extension errors*, *localhost events*, *legacy browsers*, and *web crawlers*.

**Settings → Subscription / Spend:** confirm there is **no on-demand / pay-as-you-go budget**. On the free plan, events over quota are dropped rather than billed.

### 8. Privacy policy (needs review before it ships)

Sentry is a processor that receives personal data: error messages can contain a user id, an email in a validation error, or a quoted row value. `/privacy` §7 "Sharing of Data" doesn't mention it. That section also doesn't list the other service providers (Supabase, Netlify, Resend, Upstash). Fix both at once rather than adding Sentry alone.

Draft line for §7, to adapt with the region chosen in step 1:

> **Service providers** — we use third-party infrastructure to run the platform: hosting (Netlify), database and authentication (Supabase), email delivery (Resend), and error monitoring (Sentry, servers located in &lt;region&gt;). They process data only on our instructions and only to provide their service. Error reports are retained for up to &lt;retention period&gt;.

- Fill in the retention period from the plan's data-retention setting before publishing. The account-deletion promise is 30 days. If Sentry retention is longer, either delete a user's events by hand when processing a deletion ([account-deletion.md](./account-deletion.md)), or state the longer period.
- §9 commits to 14 days' notice for significant changes. Decide whether this counts, and have a second person review the wording, as with the #503 retention change.

### 9. Verify on staging

After the staging deploy from step 5:

1. **Server, handled error (also proves the Netlify flush).** Send a malformed body to an endpoint that logs and returns 400:

   ```bash
   curl -i -X POST https://staging.mychesstour.com/api/v1/auth/signup/request-code \
     -H 'content-type: application/json' --data 'not json'
   ```

   Expect a 400 (a 429 means the per-IP signup rate limit tripped, since each call counts as an attempt; wait it out). Within a minute you should see a `SyntaxError` issue in Sentry tagged `environment:staging`, with the message *"Failed to parse JSON body in request-code endpoint"* in its extra data. If the 400 arrives but the event never does, the `after()` flush isn't being honoured on Netlify. Check `flush-after-response.ts` before going further.
2. **Browser.** On any staging page, open DevTools and run:

   ```js
   setTimeout(() => { throw new Error("Sentry browser test") })
   ```

   (The `setTimeout` matters. An error thrown directly at the console prompt doesn't reach `window.onerror`.) Expect a browser issue whose stack trace shows the original source, not minified code. Minified frames mean the source-map upload in step 5 didn't happen.
3. **Scrubbing.** Open either event and confirm there's no IP address under *User* and no cookies under *Request*.
4. **Resolve** both test issues so they don't count as regressions later.

Then repeat step 9.1 against production once, right after its first deploy with the DSN.

## Day-to-day

- **Grouping.** Log messages that interpolate an id (e.g. ``console.error(`Refund ${id}: settle_refund failed`, error)``) group by the attached `Error` when there is one. Without one, each id becomes its own issue. If that gets noisy, add a fingerprint rule under **Settings → Projects → my-chess-tour → Issue Grouping**, or move the id out of the message string and into a separate argument.
- **Expected 4xx noise.** Some routes `console.error` on client mistakes (e.g. invalid JSON). Archive those issues with *"until it escalates"* rather than deleting the log line.
- **Quota.** The free plan includes 5,000 errors a month. Check **Stats** weekly for the first month after launch.

## Not covered here

- **Uptime monitoring.** Launch-readiness S6 pairs error monitoring with an uptime check. Sentry errors only fire when the app is up enough to run code. A separate uptime monitor (Sentry Uptime if the plan includes a monitor, otherwise any free external pinger) against `https://www.mychesstour.com` covers the site being down. Track it separately.
- **User context.** Events carry no user id. Attaching the pseudonymous `users.id` with `Sentry.setUser({ id })` would make support lookups easier. Decide on it together with the step 8 privacy review.
