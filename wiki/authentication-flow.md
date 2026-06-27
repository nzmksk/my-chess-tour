# MY Chess Tour — Authentication Flow

> Onboarding guide for developers (and AI agents) working on auth-touching code.
> Covers how sessions are maintained, token lifetimes, refresh, and the
> `getAuthClaims()` vs `getUser()` decision. Read this **before** adding any
> code that reads the signed-in user.

## Table of Contents

1. [TL;DR / Golden Rules](#1-tldr--golden-rules)
2. [Provider & Clients](#2-provider--clients)
3. [How a session is maintained](#3-how-a-session-is-maintained)
4. [Tokens: access + refresh, TTL, renewal](#4-tokens-access--refresh-ttl-renewal)
5. [getAuthClaims() vs getUser()](#5-getauthclaims-vs-getuser)
6. [Where getUser() is still used, and why](#6-where-getuser-is-still-used-and-why)
7. [Authorization (RLS + permission helpers)](#7-authorization-rls--permission-helpers)
8. [Middleware route protection](#8-middleware-route-protection)
9. [Client-side auth state](#9-client-side-auth-state)
10. [Login & "Keep me signed in"](#10-login--keep-me-signed-in)
11. [Cheat sheet for new code](#11-cheat-sheet-for-new-code)

---

## 1. TL;DR / Golden Rules

- **Server code: use `getAuthClaims()`** from `@/services/supabase/permission`.
  It validates the JWT locally (no auth-server round trip) and is deduped per
  request. Returns `{ id, email, userMetadata, role }` or `null`.
- **Do NOT use `supabase.auth.getUser()` in new server code** unless you have a
  specific reason to catch *mid-session revocation* immediately (see §6). It
  costs a network round trip to the Supabase Auth server on every call.
- **Client components can't use `getAuthClaims()`** (it's server-only). They use
  the browser Supabase client / the `AuthProvider` store.
- **Never** use the admin client (`supabaseAdmin`) to *authenticate* a user — it
  bypasses all RLS and has no session. It's for trusted server-side data access.
- The middleware (`src/proxy.ts`) already verified the JWT for every matched
  page and `/api` route before your handler runs. A second `getUser()` is
  usually redundant.

---

## 2. Provider & Clients

**Provider:** Supabase Auth, cookie-based sessions via `@supabase/ssr`.
JWTs are signed with **asymmetric keys**, which is what makes local
verification (`getClaims()`) possible.

There are **three** Supabase clients — pick the right one:

| Client | File | Auth context | Use for |
| --- | --- | --- | --- |
| **Browser** | `src/services/supabase/client.ts` | Live browser session | Client components, `onAuthStateChange` |
| **Server** | `src/services/supabase/server.ts` | Reads/writes `sb-*` cookies | Server components, route handlers, server actions — RLS-scoped queries & `getClaims()` |
| **Admin** | `src/services/supabase/admin.ts` | **None** (service-role key, **bypasses RLS**) | Trusted server-only data access (webhooks, admin ops). **Never** for auth. |

Relevant env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLIC_KEY`
(publishable/anon key), `SUPABASE_SECRET_KEY` (service-role — secret, server-only).

---

## 3. How a session is maintained

The session lives in **httpOnly `sb-*` cookies** (set by `@supabase/ssr`), not in
`localStorage`. They hold the **access token** (a JWT) and the **refresh token**.

```
                                                   ┌─────────────────────┐
  Browser request  ──cookies──▶  Middleware        │ Supabase Auth server│
  (any matched route)            (src/proxy.ts)     └─────────────────────┘
                                      │                       ▲
                  getClaims():        │   (only on refresh / token expiry)
                  local WebCrypto  ───┤                       │
                  verify vs JWKS      │ ──── refresh token ───┘
                                      │      → new access token
                                      ▼
                          rewrites sb-* cookies (setAll)
                                      │
                                      ▼
            Page / route handler runs ──▶ getAuthClaims() (re-verifies locally,
                                          deduped per request)
```

Key point: **the middleware is what keeps the session fresh.** On every matched
request it calls `supabase.auth.getClaims()`, which (a) verifies the current
access token locally and (b) refreshes it via `getSession()` under the hood when
expired, writing the new cookies back through the `setAll` cookie adapter. The
comment in `src/proxy.ts:35-40` flags this as load-bearing — don't remove it.

The matcher (`src/proxy.ts:115`) covers essentially everything except static
assets, so both pages and `/api/*` are refreshed.

---

## 4. Tokens: access + refresh, TTL, renewal

**Access token (JWT)**
- Short-lived. **TTL is a Supabase project setting** (Dashboard → Auth → Sessions
  / "Access token expiry"), **default 1 hour (3600s)**. It is *not* hardcoded in
  this repo; the codebase assumes the ~1h default.
- Carries the identity claims: `sub` (user id), `email`, `role`,
  `user_metadata`, `amr` (auth-method references), `exp`, etc.
- Verified **locally** via WebCrypto against the project's JWKS — no network call.

**Refresh token**
- Long-lived, single-use, rotated on each use. Stored alongside the access token
  in the `sb-*` cookies.
- Used to mint a new access token when the old one is expired/near expiry.

**Renewal (who refreshes, when)**
- **Server:** the middleware's `getClaims()` call refreshes when needed and
  rewrites the cookies. This is the primary refresh path for SSR.
- **Client:** the browser Supabase client auto-refreshes in the background and
  emits `onAuthStateChange` (`TOKEN_REFRESHED`), which the `AuthProvider`
  listens to (see §9).
- A refresh fails (and the session ends) if the refresh token is revoked/expired
  — e.g. logout-everywhere, password change, or ban.

**Revocation window:** because the access token is verified locally, a
revocation (ban / global sign-out / password change) is **not** detected until
the current access token expires (≤ TTL, ~1h) and the next refresh fails. This
bounded window is acceptable everywhere except the payment path (see §6).

---

## 5. getAuthClaims() vs getUser()

Both live on the Supabase auth API; the difference is **local verification vs a
round trip to the Auth server**.

| | `getAuthClaims()` (wraps `getClaims()`) | `supabase.auth.getUser()` |
| --- | --- | --- |
| Validation | **Local** WebCrypto vs JWKS | **Network** `GET /auth/v1/user` |
| Latency | ~0 (no round trip) | One auth-server round trip per call |
| Detects revocation mid-session | No — only at token expiry (≤ TTL) | **Yes, immediately** |
| Per-request dedupe | Yes (React `cache()`) | No |
| Returns | `{ id, email, userMetadata, role }` \| `null` | full Supabase `User` \| `null` |
| Availability | **Server only** | Server or browser client |

`getAuthClaims()` is defined in `src/services/supabase/permission.ts`:

```ts
// src/services/supabase/permission.ts
export const getAuthClaims = cache(resolveAuthClaims); // per-request memoized

async function resolveAuthClaims(): Promise<AuthIdentity | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims(); // local JWT verification
  const claims = data?.claims;
  if (!claims) return null;
  return {
    id: claims.sub,                                   // note: sub → id
    email: claims.email ?? "",
    userMetadata: (claims.user_metadata ?? {}),
    role: claims.role,
  };
}
```

Related helpers in the same file:
- `getCurrentUser()` — same result, **uncached** (predictable outside a request,
  e.g. unit tests).
- `getNavUser()` — `getAuthClaims()` **plus** the avatar from the `users` table
  (avatar is intentionally *not* in the JWT). Used by the root layout/navbar.

**Standard server pattern:**

```ts
import { getAuthClaims } from "@/services/supabase/permission";

const claims = await getAuthClaims();
if (!claims) {
  // page:  redirect("/auth/login")
  // route: return 401 UNAUTHORIZED
}
// use claims.id  (claims.email / claims.role as needed)
```

> Gotcha: claims expose the user id as **`sub`**, but `getAuthClaims()` already
> maps it to `id`. Use `claims.id`. Don't reach for `claims.sub` yourself.

---

## 6. Where getUser() is still used, and why

`getUser()` is retained in exactly **three** places. Everything else was migrated
to `getAuthClaims()`.

| File | Reason it keeps `getUser()` |
| --- | --- |
| `src/app/api/v1/tournaments/[id]/checkout/route.ts` | **Payment initiation.** Needs an immediate server-side **revocation check** right before taking money — the ~1h local-verification window is unacceptable here. Worth the round trip. |
| `src/app/settings/_components/ProfileClient.tsx` | **Client component.** `getAuthClaims()` is server-only; this needs the live browser session. |
| `src/app/auth/signup/_components/ProfileForm.tsx` | **Client component.** Same reason. |

If you're adding a money-movement or account-takeover-sensitive server action,
consider `getUser()` for the immediate revocation guarantee. Otherwise default to
`getAuthClaims()`.

---

## 7. Authorization (RLS + permission helpers)

Authentication answers "who are you"; authorization is separate and lives mostly
in Postgres RLS + RPCs, surfaced through helpers in `permission.ts`:

- `hasOrgPermission(userId, orgId, permissionKey)` → RPC `has_org_permission`
- `hasGlobalPermission(userId, permissionKey)` → RPC `has_global_permission`
- `requireOrgPermission(...)` / `requireGlobalPermission(...)` — throw if missing

Pass `claims.id` as the user id:

```ts
const claims = await getAuthClaims();
if (!claims) return unauthorized();
const isAdmin = await hasGlobalPermission(claims.id, "platform.manage");
```

RLS-scoped reads (where the policy keys off the signed-in user) use the **server**
client. Trusted cross-user reads use `supabaseAdmin` **after** the permission
check has passed.

---

## 8. Middleware route protection

`src/proxy.ts` gates routes after resolving the session:

- **Protected prefixes:** `/admin`, `/my`, `/organizations/` (trailing slash —
  the bare `/organizations` landing is public), `/settings`. Unauthenticated →
  redirect to `/auth/login?redirectTo=…`.
- **Guest-only:** `/auth/login`, `/auth/signup`, `/auth/forgot-password`,
  `/auth/logout` — authenticated users are bounced to `/tournaments`.
- **Signup step gating:** a `SIGNUP_STEP_COOKIE` (`verify` → `profile`) prevents
  skipping signup steps by editing the URL.
- **Password reset:** `/auth/update-password` requires a *recovery* session —
  checked via the JWT's `amr` containing an `otp` method.

> Middleware runs on the **Node** runtime here (Next 16 `src/proxy.ts`), not edge.

---

## 9. Client-side auth state

`src/components/AuthProvider.tsx` (mounted in the root layout) owns app-wide auth
state in a Zustand store:

1. **Seed from server:** the layout resolves the user via `getNavUser()` and
   passes it down; `toAuthUser()` (`src/lib/auth-user.ts`) normalizes either a
   JWT-claims shape (`sub`) or a session-user shape (`id`) into the store. No
   client round trip needed for first paint.
2. **Stay live:** a single `supabase.auth.onAuthStateChange` subscription updates
   the store on sign-in/out and token refresh — including changes made in other
   tabs.
3. **Avatar** is not in the JWT; it's seeded by the server and kept in sync via a
   cross-tab broadcast, never derived from auth events.

---

## 10. Login & "Keep me signed in"

`src/app/auth/login/_actions/login.ts`:

- Validates input, then rate-limits with Redis: **5 attempts**, **15-minute
  lockout** per email.
- Calls `supabase.auth.signInWithPassword({ email, password })`.
- Blocks unverified accounts (`users.is_verified`): signs out locally, re-sends a
  verification code, and routes into the verify step.
- On success, redirects to a sanitized `redirectTo` (defaults to `/tournaments`).

**"Keep me signed in"** controls cookie persistence:
- Unchecked → `createClient({ sessionOnly: true })` writes the `sb-*` cookies
  **without** `maxAge`/`expires`, so they're **session cookies** (cleared when the
  browser closes). A `SESSION_ONLY_COOKIE` marker is set so the middleware keeps
  *refreshed* cookies session-scoped too (`stripPersistence`, `src/lib/session-cookie.ts`).
- Checked → persistent cookies; the marker is deleted.

---

## 11. Cheat sheet for new code

**Server component / route handler / server action — read the user:**
```ts
import { getAuthClaims } from "@/services/supabase/permission";

const claims = await getAuthClaims();
if (!claims) { /* redirect("/auth/login") OR 401 */ }
const userId = claims.id;
```

**Need an RLS-scoped query or an RPC?** Keep the server client:
```ts
import { createClient } from "@/services/supabase/server";
const supabase = await createClient();
await supabase.rpc("has_global_permission", { p_user_id: claims.id, p_permission: "platform.manage" });
```

**Do / Don't**
- ✅ Default to `getAuthClaims()` server-side. ❌ Don't add `getUser()` "just to be safe".
- ✅ Use `claims.id`. ❌ Don't read `claims.sub` directly.
- ✅ Use `supabaseAdmin` only *after* an explicit permission check. ❌ Never to authenticate.
- ✅ Reserve `getUser()` for payment / takeover-sensitive immediate-revocation needs.
- ✅ Trust that middleware already refreshed/verified the session for matched routes.

**Key files**
- `src/proxy.ts` — middleware: session refresh + route protection
- `src/services/supabase/permission.ts` — `getAuthClaims`, `getNavUser`, RBAC helpers
- `src/services/supabase/{server,client,admin}.ts` — the three clients
- `src/lib/session-cookie.ts` — "Keep me signed in" persistence
- `src/lib/auth-user.ts` — claims/session → store identity
- `src/components/AuthProvider.tsx` — client auth state
- `src/app/auth/login/_actions/login.ts` — login + rate limiting
