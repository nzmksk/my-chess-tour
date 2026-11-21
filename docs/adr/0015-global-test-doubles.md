# 0015. Global test doubles

- Status: Accepted
- Date: 2026-11-21
- Issue: #504, #505, #613, #675

## Context

Some infrastructure is touched by almost every route: resolving the signed-in
user's application id, the rate limiter, and Next's `after()`. Making each
route test model it would bury what the test is about, and a few of them hide
bugs unless the double is built a particular way.

## Decision

`src/test/setup.ts` installs three doubles for the whole Vitest suite.

**Auth ids and app user ids differ.** Resolving a session costs one lookup on
`users.auth_user_id` (`lookupAppUserId`, `src/services/supabase/identity.ts`).
The stub returns `appIdFor(authId)` (`src/test/identity.ts`), which is
deliberately _different_ from the auth id. In production the two are equal for
every self-signup row (`handle_new_user` writes `id = auth_user_id`), so a
route that passes a raw auth id into a query behaves exactly like a correct
one. That's how the checkout route kept doing it through a full sweep and a
green suite. Forcing the ids apart turns that bug into a failing assertion
before managed records (#504, #505) make the ids differ for real.

In a test, `sub` on the mocked JWT is the _auth_ id, and anything that filters
or writes an application table should be `appIdFor(sub)`; use the helper
rather than hard-coding its prefix. A test that needs specific ids, or a
session with no linked record, overrides the stub per case. The real lookup is
tested in `src/services/supabase/__tests__/identity.test.ts`, which unmocks it.

**The rate limiter's counter always allows.** The real `hitWindow` talks to
Upstash, which in a test means slow retries against a dummy URL. A test for a
429 makes it return the seconds to wait
(`vi.mocked(hitWindow).mockResolvedValueOnce(600)`). The real counter is
tested in `src/services/rate-limit/__tests__/window.test.ts`.

**`after()` holds its callbacks** (`src/test/after.ts`), the way Next holds
them until the response is sent; the rest of `next/server` is real. A test
that expects work after the response calls `runAfterCallbacks()` once the
handler has returned, which also proves the handler didn't wait for it.
Callbacks run concurrently, like Next's, including any they schedule.

`src/test/appRoutes.ts` derives the real App Router routes from the
filesystem, so a test asserting that a link resolves fails as soon as a page
moves or a dynamic segment is renamed.

## Consequences

- Route tests stay about the route.
- A new piece of shared infrastructure that every route calls belongs here,
  with its real implementation tested on its own.
