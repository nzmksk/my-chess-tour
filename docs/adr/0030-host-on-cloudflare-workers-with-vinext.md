# 0030. Host on Cloudflare Workers with vinext

- Status: Proposed. It becomes Accepted once staging runs on a `*.workers.dev`
  URL and passes the checks under "Still to confirm".
- Date: 2026-11-28
- Issue: #795

## Context

Both sites run on Netlify's free plan, whose functions run only in us-east-2
(Ohio). Choosing a region costs $20/month. Our users are in Malaysia and the
database is moving to Singapore (#793), so every request crosses the Pacific at
least once. Cloudflare Workers run at the nearest Cloudflare location, or next
to the database with Smart Placement, for about $5/month on Workers Paid.

Two adapters run a Next.js app on Workers:

- **vinext** (`cloudflare/vinext`): a Vite 8 plugin that reimplements the
  Next.js API. It doesn't run `next build`. Its README still calls it "under
  active development".
- **OpenNext** (`@opennextjs/cloudflare`): adapts a real `next build`. When we
  tried it before, it rejected `src/proxy.ts` (Node middleware).

## Decision

Use **vinext 1.4.7** with the Cloudflare target, set up by
`vinext init --platform=cloudflare --cdn-cache=response-store
--response-store-mode=self-contained --image-optimization=none`.

- `vite.config.ts` registers `vinext()` with
  `responseStoreAdapter({ mode: "self-contained" })` and
  `@cloudflare/vite-plugin`.
- `cloudflare.config.ts` (read by the `cf` CLI) defines the Worker:
  `nodejs_compat`, an `ASSETS` binding, the Response Store's R2 bucket and
  `CacheMetadata` Durable Object, and every server-only secret declared with
  `bindings.secret()`. A secret that isn't declared there never reaches
  `process.env` at runtime: every route returned 500 until they were declared.
  `NEXT_PUBLIC_*` values are inlined at build time, as before.
- **Workers Response Store, self-contained**: a single Worker holds both the
  `unstable_cache`/`revalidateTag` data cache and route-level ISR, with bodies
  in R2 and metadata in a Durable Object. vinext doesn't allow it to be
  combined with the KV data cache. The service-binding mode needs a second
  Worker to deploy, which this app doesn't need.
- **No image optimization**: `next/image` serves the source file. The
  Cloudflare Images binding charges per transformation, and the images are
  mostly SVG logos and uploaded documents.
- Email templates are bundled with
  `import.meta.glob("./templates/*.html", { query: "?raw" })` in
  `src/services/email/template-source.ts` instead of being read from disk
  (Workers have no filesystem). Vite and Vitest support `?raw` natively, and
  `next.config.ts` adds a matching `turbopack.rules` entry, so `next build`
  keeps working while Netlify still deploys staging.
- `resolveReleaseVersion` fetches tags on Workers Builds (`WORKERS_CI=1`) as it
  does on Netlify, and `resolveReleaseCommit` reads `WORKERS_CI_COMMIT_SHA` as
  well as `COMMIT_REF`.

Checked on a local `vite preview` (workerd) build against staging's services:

- Every page and API route renders. `src/proxy.ts` runs: `/my` redirects to
  `/auth/login?redirectTo=%2Fmy`.
- `next/font/google` is self-hosted under `/_next/static/_vinext_fonts/`. The
  pages make no request to `fonts.gstatic.com`.
- The changelog's `unstable_cache` is served from the Response Store. Repeat
  hits make no GitHub API call. A signed `release` webhook (HMAC via
  `node:crypto`) clears the tag, and the next hit makes exactly one call.
- The CHIP webhook's `crypto.createVerify("RSA-SHA256")` parses the real public
  key and rejects a bad signature with 401. It logs "did not match" rather
  than a key-parse error.
- `after()`, `afterResponse` and `inOrderAfterResponse` run after the
  response, in order, and a failing task is contained.
- The Worker bundle is 4.6 MB raw and 1.09 MB gzipped, under the Workers limit.

## Consequences

- `package.json` is `"type": "module"`, and React moves to 19.3 because
  vinext's peer range needs it. Tests, ESLint, knip and `next build` still
  pass.
- Turbopack and webpack config don't carry over to vinext. vinext ignores
  `withSentryConfig`'s webpack options, so **Sentry source maps won't upload**:
  production stack traces will be minified until `@sentry/vite-plugin` or
  `sentry-cli sourcemaps upload` is added to the deploy.
- Inside an `after()` callback, `cookies()` throws on vinext, while Next.js
  allows it in route handlers. No task we schedule today reads cookies: they
  all use the admin Supabase client. A new after-response task must not depend
  on the request's cookies or headers.
- `preferredRegion` is ignored, and `runtime` doesn't choose where a route
  runs. Placement comes from Smart Placement (`placement: { mode: "smart" }` in
  `cloudflare.config.ts`), which moves the Worker next to the database once it
  sees enough subrequest traffic.
- `cf` 1.0.0-rc.6 asks for Node ≥ 24.22, so CI and Workers Builds need that
  version.

### Still to confirm

- CPU time per request on a deployed Worker, especially the `fide-ratings` and
  `payouts` crons (`maxDuration` 300). workerd doesn't enforce CPU limits
  locally.
- Whether `instrumentation.ts` and `onRequestError` report to Sentry from
  production the way they do on Netlify, and whether
  `src/services/sentry/flush-after-response.ts` is still needed.
- The payment scenarios in `docs/wiki/payment-flow.md` on staging.
- If any of these fail in a way vinext can't fix, try `@opennextjs/cloudflare`
  and supersede this ADR.
