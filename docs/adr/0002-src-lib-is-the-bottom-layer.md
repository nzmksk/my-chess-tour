# 0002. `src/lib` is the bottom layer

- Status: Accepted
- Date: 2026-11-21
- Issue: #675

## Context

`src/lib` holds framework-agnostic helpers that the whole app shares: money,
dates, validation, reference data. Components, stores and app routes all
import from it. If `lib` imported any of them back, the layers would form a
cycle and a "helper" would drag UI or state code into every caller.

## Decision

`src/lib` may not import from `src/components`, `src/stores` or `src/app`. The
`no-restricted-imports` block for `src/lib/**` in `eslint.config.mjs` enforces
it. Code that both `lib` and a higher layer need moves down into `lib`.

## Consequences

- Anything in `lib` can be unit-tested and reused without React, Zustand or
  Next.
- A helper that needs a component or store doesn't belong in `lib`; it lives
  next to its caller instead.
- Types that stores share with server code live in `lib` too: `AuthUser`
  (`src/lib/auth/auth-user.ts`), `Role` and `UserOrganization`
  (`src/lib/auth/roles.ts`). Defining them in a store would make `lib` depend
  on stores, and defining them in `src/services/supabase/permission.ts` would
  pull server-only Supabase code into the browser bundle.
