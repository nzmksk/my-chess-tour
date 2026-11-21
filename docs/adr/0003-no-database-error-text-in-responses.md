# 0003. No database error text in responses

- Status: Accepted
- Date: 2026-11-21
- Issue: #487, #675

## Context

Errors from Postgres, PostgREST and the Supabase auth server carry messages
that describe the schema: table, column and constraint names, and sometimes
the offending values. Returned to the client, they tell an attacker how the
database is built and show users text they can't act on.

## Decision

An API route never puts an error's `message` in a response body. It logs the
error and returns `internalErrorResponse()` from
`src/lib/http/internal-error.ts`, or writes its own message for the user.

The `no-restricted-syntax` block for `src/app/api/**/*.ts` in
`eslint.config.mjs` catches the common shapes: a `message:` property, or an
`errorResponse` / `respond` / `fail` / `err` / `serverError` argument, taken
from a variable named `e`, `err`, `error` or ending in `Err` / `Error`.

## Consequences

- Clients see `INTERNAL_ERROR_MESSAGE` with code `INTERNAL_ERROR`. The detail
  goes to `console.error`, which Sentry captures
  (`src/services/sentry/server.ts`), so nothing is lost.
- The lint selectors match names, not types. An error held in a differently
  named variable slips through, so review still has to watch for it.
