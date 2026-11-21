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

## Logging the detail

`logInternalError` is the logging half, for code that reports a failure
without building a response (loaders shared by a page and a route, server
actions). How it logs is deliberate:

- `console.error` formats its first argument printf-style whenever more
  arguments follow, and `context` often carries request values. A `%c` in an
  id from the URL would swallow the error detail. So it logs either one
  string, which is never formatted, or the context with `%` escaped.
- An `Error` stays a separate argument, so the log keeps its stack and Sentry
  records it as an exception rather than a message.
- Supabase errors are plain `{ code, message, details, hint }` objects that
  would print as `[object Object]` once Sentry stringifies them, so they are
  flattened to one line.
- `context` names the route and operation (for example
  `"Org applications: create_organization_application failed"`) so the Sentry
  event can be found.
