# Product analytics (PostHog)

How we measure what people do on the site (which pages they reach, where they drop out of registration) and the one-time setup that turns it on. Issue #126; [launch-readiness](./launch-readiness.md) S6.

The code is in place and does **nothing** until `NEXT_PUBLIC_POSTHOG_KEY` is set in a site's environment. Everything under [Setup](#setup) is account and dashboard work: no code changes.

## What gets captured

| Event          | When                                             | Notes                                                                                   |
| -------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `$pageview`    | Every page load and every client-side navigation | From `defaults: "2026-08-30"` (`capture_pageview: "history_change"`)                    |
| `$pageleave`   | Leaving a page                                   | Gives time on page and bounce rate                                                      |
| `$autocapture` | Clicks on links and buttons, form submits        | Element tag, classes, `href`. **No page text** (`mask_all_text`) and never input values |
| `$web_vitals`  | Core Web Vitals, if enabled in the project       | Project setting, off unless you turn it on                                              |

All of it is browser-only, initialised in `src/instrumentation-client.ts` next to Sentry, configured in `src/services/posthog/options.ts`. No server-side events, no custom events yet. `defaults` is pinned to a date so that upgrading `posthog-js` can't silently change what gets captured; move it forward deliberately, after reading PostHog's changelog for the new defaults. Funnels such as _tournament page → `/register` → `/register/success`_ can be built from `$pageview` URLs alone.

### Privacy design

The privacy policy says we use no tracking cookies, and the platform asks for nothing it doesn't need. The setup keeps both true without a consent banner:

- **Cookieless (`cookieless_mode: "always"`).** No cookies, `localStorage` or `sessionStorage`. PostHog counts unique visitors with a hash of IP + user agent + a salt that rotates daily, computed on its servers. Trade-off: the same person is a new visitor each day, and across devices. Daily and weekly unique counts and funnels within a visit still work. **The project setting in step 3 is required, or PostHog silently drops every event.**
- **No page text (`mask_all_text`).** Autocapture records which element was clicked but not its text: names, emails and ratings are rendered as text throughout the app.
- **Never identified.** The code never calls `posthog.identify`, so events can't be tied to an account and no person profiles are created. Don't add `identify` without revisiting the privacy policy. Cookieless mode can't keep an identity between page loads anyway.
- **URLs are scrubbed before sending** (`src/services/posthog/scrub.ts`, a `before_send` hook):
  - the fragment is dropped (Supabase puts session tokens in it on password-recovery and magic-link redirects);
  - query parameters are **allowlisted** (`tab`, `status`, `sort`, `order`, `page`, `utm_*`); everything else goes, including auth codes, `token_hash`, `redirectTo`/`next`, error messages and free-text search;
  - `/invitations/<token>` becomes `/invitations/:token` (the token is a bearer secret);
  - a referrer from another site is cut to its origin (e.g. the CHIP payment page path names a purchase).

  If you add a page whose path or query carries a secret, extend `SECRET_PATH_SEGMENTS` or leave the parameter off the allowlist. Tests are in `src/services/posthog/__tests__/scrub.test.ts`.

- **Forced off in code, whatever the project settings say:** session replay (records what users see and type), exception capture (Sentry does that), surveys, product tours, conversations, web experiments.
- **Do Not Track** is respected (`respect_dnt`).
- Every event carries an `environment` property from `NEXT_PUBLIC_ENVIRONMENT`, so staging traffic can be filtered out (step 4).

**Deliberately not done:**

- **Reverse proxy.** Ad-blockers block `*.posthog.com`, so some visits go uncounted. A proxy would route events through our own domain. Through a Next.js rewrite that means a Netlify function invocation per event, and the proxy matcher in `src/proxy.ts` would need to exclude the path. Revisit if the numbers look low: point `NEXT_PUBLIC_POSTHOG_HOST` at the proxy and no code changes.
- **Consent banner.** Not needed while analytics stays cookieless and anonymous. If cookies or identification are ever wanted, switch to `cookieless_mode: "on_reject"` with a banner, and update the policy.

## Environment variables

| Variable                   | Value                                                                                                    | Production site | Staging site  | Secret?                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | --------------- | ------------- | ----------------------------------- |
| `NEXT_PUBLIC_POSTHOG_KEY`  | Project API key (step 2), starts with `phc_`                                                             | ✅              | ✅ (same key) | No: it only allows _sending_ events |
| `NEXT_PUBLIC_POSTHOG_HOST` | Leave unset for PostHog Cloud **US**. `https://eu.i.posthog.com` only if the project is in the EU region | Optional        | Optional      | No                                  |

- `NEXT_PUBLIC_ENVIRONMENT` (already set on both sites) tags each event. Make sure it is `staging` on staging.
- `NEXT_PUBLIC_` values are **inlined at build time**. Changing them needs a redeploy.
- Netlify stores values verbatim. Paste them **without quotes**.
- Locally: leave the key unset (the default) and nothing is sent. To try it locally, put the key in `.env.local`; events arrive tagged `environment: development`.

## Setup

### 1. Create the PostHog organization and project

1. Sign up at posthog.com on the **free** plan. Use the shared/ops mailbox, as for Sentry, so ownership survives people changes.
2. **Choose the region: US Cloud.** This can't be changed later. It decides where analytics data is stored, and the privacy policy says **United States** (it matches Sentry). If you pick EU instead, set `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com` on both sites **and** change the policy wording (step 7).
3. Name the organization (e.g. `MY Chess Tour`) and the project (`my-chess-tour`). One project serves both sites.
4. When the onboarding asks to install the snippet or run a wizard, **skip it**. The SDK is already wired in.

### 2. Copy the project API key

**Project settings → General → Project API key** (`phc_…`). This is `NEXT_PUBLIC_POSTHOG_KEY`. Don't confuse it with a _personal_ API key (`phx_…`), which **is** secret and isn't needed.

### 3. Project settings (required before any event is kept)

**Project settings → General** (names may differ slightly in PostHog's UI):

1. **Cookieless server hash mode: enable** (it might be called _Cookieless tracking_). Without it, every event from this app is **dropped**.
2. **Discard client IP data: on.** The policy says PostHog doesn't store IP addresses. Location is still estimated from the IP at ingestion. After step 6, check that events still show a country and that unique visitors aren't all collapsed into one. If either breaks, tell the developer before launch rather than turning the setting off: the policy wording depends on it.
3. **Session replay: leave off.** The code forces it off anyway.
4. **Autocapture: leave on.** **Heatmaps / dead clicks:** your call, they only send coordinates and element selectors. **Web vitals:** your call; cheap and useful.
5. **Exception autocapture: off.** Errors go to Sentry. The code forces it off anyway.
6. **Authorized URLs / Toolbar:** add `https://www.mychesstour.com` and `https://staging.mychesstour.com` so the toolbar works on the live sites.

### 4. Filter staging out of reports

**Project settings → Product analytics → Filter out internal and test users → add filter:** event property `environment` **is not** `production`. (If the filter UI won't take an event property, use `$host` **is not** `www.mychesstour.com` instead; that also drops local traffic.)

Then leave **"Filter out internal and test users"** ticked (the default) on insights and dashboards, and staging and local traffic won't count. Untick it on an insight to see staging, e.g. during step 6.

### 5. Configure Netlify (both sites)

For the **production** site, then the **staging** site: **Project configuration → Environment variables → Add a variable**: `NEXT_PUBLIC_POSTHOG_KEY` = the `phc_…` key, **not** marked secret (it ends up in the browser bundle, so a secret one fails the build's secret scan), all scopes, same value for all deploy contexts. Add `NEXT_PUBLIC_POSTHOG_HOST` only for an EU project.

Then **Deploys → Trigger deploy → Deploy site** on each.

### 6. Verify on staging

1. Open `https://staging.mychesstour.com` in a normal browser window with **ad-blockers off** (they block `us.i.posthog.com`).
2. DevTools → **Network**, filter `posthog`. Click around: there should be requests to `us.i.posthog.com/e/` (or `/i/v0/e/`) returning 200.
3. DevTools → **Application**: there must be **no** `ph_…` cookie and **no** `ph_…` entries in Local or Session Storage. If there are, cookieless mode isn't active.
4. In PostHog, **Activity** (live events), with _Filter out internal and test users_ **unticked**: `$pageview` events appear with `environment = staging`.
5. Scrubbing: visit `https://staging.mychesstour.com/auth/login?redirectTo=/my&message=x` and `https://staging.mychesstour.com/invitations/test-token-123`. In Activity the URLs must show as `/auth/login` and `/invitations/:token`.
6. Open one event and check its properties: no `$ip`, and a `$geoip_country_name`.
7. Tick _Filter out internal and test users_ again: the staging events disappear from insights.

Repeat 1–4 on production after its first deploy with the key (expect `environment = production`, and the events stay visible with the filter ticked).

### 7. Privacy policy (wording added; review before launch)

PostHog is a processor that receives personal data (an IP address at ingestion, and browsing behaviour). The policy discloses it, in both `/privacy` and the signup `PrivacyModal.tsx`, which must stay identical:

- **§7 Sharing of Data:** a PostHog entry: what it receives, that the IP is used for approximate location and not stored, no cookies or device storage, not linked to the account, URLs scrubbed, servers in the **United States**.
- **§4 Data Retention:** _Usage analytics (PostHog): 1 year, then deleted automatically._
- **§8 Cookies:** analytics uses no cookies or device storage.
- The first-version summary in `src/lib/reference/legal.ts` mentions PostHog.

`TERMS_VERSION` was **not** bumped, for the same reason as Sentry ([error-monitoring.md](./error-monitoring.md#8-privacy-policy-wording-added-review-before-launch)): nothing has been published to users yet. Once the platform is live, a change like this needs a new `TERMS_HISTORY` entry.

**If the setup changes, change the policy with it:**

- **Region:** the policy says United States. An EU project means new wording.
- **Retention: confirm "1 year".** Check the organization's billing/plan page for the event retention on the plan you're on. If it is longer (paid plans keep data for years), either set a shorter retention in PostHog if the plan allows it, or change the policy to state the real period.
- **Discard client IP data** must stay on, or remove "which PostHog does not store" from the policy.
- Adding `identify`, session replay, or cookies all need new wording (and, for cookies, a banner).

**Still open:** a second person reviews the wording before launch, together with the Sentry wording, including whether the US transfer needs anything more under the PDPA's cross-border transfer rules (s129).

## Day-to-day

- **Quota.** The free plan includes a monthly allowance of analytics events (1 million at the time of writing). Check **Billing** in the first week after launch. With no card on file, PostHog stops ingesting over the allowance rather than billing; if a card is added, set a billing limit.
- **Funnels.** Build them from `$pageview` with _Path name_ filters: `/tournaments/<slug>` → `/tournaments/<slug>/register` → `/tournaments/<slug>/register/success` (or `/register/failure`). Paths keep the slug, so a funnel can be per tournament, or across all of them with _contains_ `/register/success`. The success page is CHIP's return page, so it counts players who came back from paying, not confirmed payments: the webhook confirms those.
- **Custom events.** If a step isn't a page (e.g. "clicked Pay"), add `posthog.capture("…")` in the component. Keep personal data out of event properties. The `before_send` hook only scrubs URL properties.
