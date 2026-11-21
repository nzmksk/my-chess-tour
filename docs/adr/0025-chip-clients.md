# 0025. The CHIP Collect and CHIP Send clients

- Status: Accepted
- Date: 2026-11-21
- Issue: #519, #520, #675

## Context

Money comes in through CHIP Collect (`src/services/chip/chip.ts`) and goes out
through CHIP Send (`src/services/chip/send.ts`). Both are reached from two
directions, a synchronous API response and a webhook, and both have behavior
their documentation doesn't spell out. [chip-webhook](../wiki/chip-webhook.md)
covers both webhooks: signatures, key formatting, events and responses.
[payment-flow](../wiki/payment-flow.md) covers the single payment window and why
CHIP's `expired` isn't a failure for us.

## Decision

**One interpreter per kind of CHIP state.** `chipOutcome`,
`chipRefundOutcome`, `chipSendOutcome` and
`chipBankAccountOutcome` are the only places a CHIP status or event is read.
The webhook and the synchronous path both call them, so they can't classify
differently. Anything unrecognised is `"pending"`: we wait for the webhook
rather than guess. In particular:

- A purchase that is `cleared` or `settled` counts as paid. Some card payments
  move on from `paid` to these states, and CHIP reaches them only through
  `paid`.
- Refund events (`payment.refunded`, `purchase.refund_failure`) never match the
  registration mapper; `isChipRefundEvent` routes them to the refund path.
- A send instruction succeeds only when `completed`. `accepted` can still end
  `rejected` after review, so it's pending. `rejected` and the legacy
  `deleted` are the only failures.
- Send outcomes come from the resource's own `status` or `state`, never from
  an event name. CHIP Send's events are topics (`bank_account_status`,
  `send_instruction_status`, `budget_allocation_status`) sent in the
  `Event-Type` header, and CHIP tells integrators to trust the body's state
  over the header. There are no dotted names such as
  `send_instruction.completed`. An older copy of CHIP's integration skill
  invented them, and we used to match them.

**Refunds come back in two shapes.** A refund that cleared returns the refund
Payment, whose `id` is a new Payment id and which has no `status`; one still
processing returns the original Purchase with `status: "pending_refund"`, so
`result.id` is the purchase id and there's no refund id to record yet. Narrow
with `isPendingRefund`. A full refund omits the body entirely. A
`400 purchase_refund_error` carries no detail; the reason is on the Purchase at
`transaction_data.attempts[0].error`.

**Collect calls retry what CHIP says is safe to retry, under an idempotency
key.** Every Collect request goes through `chipCollectRequest`
(`src/services/chip/chip.ts`), which follows CHIP's
[errors page](https://docs.chip-in.asia/chip-collect/overview/errors):

- Each write (create, cancel, refund) sends a fresh `Idempotency-Key`. A
  repeat with the same key and body returns the first result instead of acting
  twice.
- A network failure, `500` or `503` is retried with the same key, up to three
  attempts in all, with exponential backoff and jitter. A `429` is retried
  after its `Retry-After` when that is at most 2 seconds, and after the backoff
  when there's no header. A longer wait fails the call, and the caller's own
  retry path takes over.
- `502` isn't retried. CHIP says to wait for the webhook, because the bank or
  card network may still complete the payment. No other `4xx` is retried.

The key lives for one call, not one refund or payment. CHIP replays the first
result for a key, so a refund key reused after a definite
`400 purchase_refund_error` would replay that failure forever, when the refund
is meant to be retried on the same row. A refund re-fired after the stuck
interval checks the purchase at CHIP first, so a fresh key there can't refund
twice. The Errors page is the only source for the header; the OpenAPI document
doesn't list it.

**Send is its own module.** Different host, a three-header auth scheme, string
amounts on instructions and per-webhook RSA-SHA512 keys instead of one
RSA-SHA256 key: sharing code with Collect invites the cross-wiring the vendor
warns about. Its host comes from `CHIP_SEND_API_URL` with no fallback, because
staging and production are different CHIP environments, and a default would
let an environment with the variable unset quietly talk to the wrong one. The
OpenAPI document (<https://docs.chip-in.asia/openapi/chip-send.yaml>) is the
source of truth; the interfaces under `src/services/chip/interfaces` mirror
CHIP's own field documentation, which is read there rather than repeated.

**Three Send landmines**, each pinned by `send.test.ts`:

1. `send_limits.amount` is a JSON number and `send_instructions.amount` a
   string. The exported functions take integer cents and convert, so no caller
   builds either body by hand. Conversions use integer arithmetic and parse
   ringgit from its digits, so 19.99 can't land a sen short.
2. The epoch and checksum (`HMAC-SHA512(secret, epoch + apiKey)`, lowercase hex)
   are recomputed for every request. CHIP rejects an epoch more than about 30
   seconds off, and the vendor calls a memoized checksum the most common
   integration bug, so `chipSendHeaders()` is a function that is never cached.
   The test pins both our own vector and the vendor's published example. When
   #519 was written, the vendor's example omitted the API secret and couldn't be
   reproduced; CHIP's Send introduction now includes it.
3. Insufficient balance has two faces: the documented 403, and the 400 "Balance
   not enough. Please increase your Send Limit" that the sandbox actually
   returns for instructions and bank-account registration (#520).
   `ChipSendError.insufficientBalance` flags both, so a payout waits for budget
   instead of failing for good.

**Amounts are ringgit.** The spec documents every Send amount in ringgit, while
CHIP's skill notes say MYR × 100 as in Collect. We follow the spec, which is
also the safe side: if it were wrong we'd send a hundredth of the amount, not a
hundred times it.

**Errors carry nothing about the request.** `ChipSendError` holds the status and
body for diagnosis only, because the request headers hold the bearer key and a
checksum derived from the secret, and the error is logged.

**Descriptions are restricted.** CHIP allows only letters, digits, space and
`. _ - / @ ( )` in a description, up to 140 characters, and 422s on anything
else, which the spec doesn't say; staging found it when a colon failed every
payout. `toChipSendDescription` folds accents, drops apostrophes, turns other
runs into a space, trims, and never returns an empty string, which CHIP also
refuses. See [0024](0024-text-to-and-from-chip-send.md).

## Consequences

- A new CHIP endpoint starts from the OpenAPI document and a test that pins
  the body shape.
- A new Send state or event is handled pending until someone decides
  otherwise. Adding one starts with CHIP's
  [event types and payloads](https://docs.chip-in.asia/chip-send/api-reference/webhooks/events)
  page.
