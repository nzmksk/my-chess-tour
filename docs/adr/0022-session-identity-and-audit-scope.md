# 0022. Session identity and audit scope on the server

- Status: Accepted
- Date: 2026-11-21
- Issue: #470, #501, #504, #505, #675

## Context

[launch-readiness](../wiki/launch-readiness.md) (S3 and the identity
indirection under S7) records the database side: `users.auth_user_id` is the
only link to Supabase Auth, every policy goes through `app_user_id()`, and the
audit trigger trusts `x-audit-actor` and `x-audit-context` headers on
service-role requests. This record covers the app side.

## Decision

**Two ids, one bridge.** `AuthIdentity.id` (`src/services/supabase/permission.ts`)
is the `public.users.id` that every foreign key and policy resolves to, and
what code almost always wants. `authUserId` is the Supabase Auth id, only for
calls into Supabase Auth (`auth.admin.deleteUser`, `updateUserById`). They're
equal for self-signup accounts today, but that's a detail of
`handle_new_user`, not an invariant: a record created without a login (#504)
has its own id and no `auth_user_id` until claimed (#505).

- `lookupAppUserId` (`src/services/supabase/identity.ts`) is the only code that
  follows the link, the twin of `app_user_id()`. It's its own module so route
  tests can stub it (ADR 0015), and it isn't re-exported from `permission.ts`,
  so there's one import path. It reads with the service-role client because
  the RLS policy on `users` is itself written with `app_user_id()`; asking
  "who am I" through the anon client would be circular.
- A valid session with no linked user means signup half-completed. That fails
  closed: inventing an id would write orphaned rows.
- `getAuthClaims` verifies the JWT locally with `getClaims()` and is memoized
  per request, so a render that needs identity ten times pays for the lookup
  once. It's the only identity accessor; an uncached twin (`getCurrentUser`)
  was removed in #678 so new code can't pick the one that repeats the lookup.
- Service-role reads scoped to the caller, such as `getUserOrganizations`,
  depend entirely on their `user_id` filter, so they must be given the
  authenticated `claims.id`, never a client-supplied id.
- The server client (`src/services/supabase/server.ts`) ignores the error
  `setAll` throws when called from a Server Component, which can't set
  cookies. The proxy refreshes the session on every request, so nothing is
  lost.

**The audit scope follows the request.** `withAuditContext(label, handler)`
(`src/services/supabase/audit-context.ts`) opens an `AsyncLocalStorage` scope
for a whole route handler, and `supabaseAdmin`'s `fetch` adds the headers to
every request inside it, including `afterResponse` work, which Next binds to the
request's async context. Nothing is threaded through the services.

- The actor is filled in by `getAuthClaims` (`noteAuditActor`) on every call,
  not just the first, because a memoized result can come from before the scope
  opened. A caller that already knows the actor passes `actorId`.
- `fn`'s result is awaited _inside_ the scope. A Supabase query builder sends
  nothing until awaited, so `() => supabaseAdmin.rpc(...)` returned un-awaited
  would run after the scope closed, without headers.
- Labels are `area.action`, lower-case with dots and hyphens
  (`tournament.publish`, `admin.payout.review`, `webhook.chip`), at most 100
  characters. Outside a scope there are no headers, and the trigger records
  context `trigger` with no actor.
- Housekeeping done on someone's behalf, like the roster's expiry sweep, opens
  its own scope with no actor (ADR 0021).

## Consequences

- Filtering an application table by `authUserId` is a bug, and the global test
  double makes it fail.
- A new route handler that writes through `supabaseAdmin` should be wrapped in
  `withAuditContext`.
