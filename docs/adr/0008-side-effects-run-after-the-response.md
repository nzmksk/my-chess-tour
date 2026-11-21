# 0008. Side effects run after the response

- Status: Accepted
- Date: 2026-11-21
- Issue: #675

## Context

Notification emails and similar side effects shouldn't hold up the request
that caused them. Some of them also have an order the reader sees: "your
payout was approved" has to arrive before "your payout was sent", even when
the send completes in the same request.

## Decision

`afterResponse(task)` (`src/lib/http/after-response.ts`) runs a task once the
response has been sent, through Next's `after()`, which keeps the function
alive until the task settles. A failing task is logged and never reaches the
caller. Outside a request, or where the platform gives `after()` no way to
outlive the response, it runs the task immediately and logs that it did:
dropping the work would be worse, but on a serverless runtime work left
running after the response may be frozen part-way.

Tasks run concurrently by default. Inside `inOrderAfterResponse(fn)`, every
task scheduled by `fn` or anything it awaits joins one queue (tracked with
`AsyncLocalStorage`) and runs one at a time in scheduling order. The queue is
scheduled even when `fn` throws: the work before the throw happened, and so
should its emails. A task scheduled after `fn` settles falls outside the
scope.

## Consequences

- Emails sent this way are best-effort; their failure doesn't fail the
  request.
- Code whose emails must arrive in order has to wrap the whole operation in
  `inOrderAfterResponse`.
