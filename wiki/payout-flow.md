# Payout flow (organizer disbursement)

How an organization receives its tournament revenue through **CHIP Send**. As in the [payment](./payment-flow.md) and [refund](./refund-flow.md) flows, money state is enforced in Postgres (SECURITY DEFINER functions + row locks), network calls happen outside those transactions, and settlement is idempotent so the synchronous response and the webhook can't double-book.

Scope: the payout machine and the admin trigger (#520), early payouts and their review (#521). The automatic sweep is #522, platform-managed prizes are #523.

## What is owed

`tournament_payout_summary` is a pure ledger projection:

```
net_payout_cents         = (net_registration - net_refunded) - total_payouts
prize_pool_balance_cents = total_prize_funding - total_prizes
```

Prizes are not in the first line. Entry fees never fund prizes, so prize money is ring-fenced in the second.

The view only subtracts **paid** payouts. How much may leave right now is `available_payout_cents(tournament, exclude_payout)`, which also subtracts payouts in flight. Every call site uses it. It closes the window in which two payouts could both see the same money.

## The flow

1. **Queue.** `queue_payout` locks the tournament, refuses if anything is in the way (below), checks the requested amount against what is available, resolves the recipient and its verified bank account, and inserts the row. An omitted amount means everything available; an explicit one above that is refused, not reduced. A live automatic payout already there means it returns NULL. This row is what reserves the money.
2. **Send.** `executePayout` (`src/services/payouts/execute.ts`) re-checks blocks and the bank account, re-clamps the amount and checks the balance. Then `claim_payout_send` re-checks the blocks **under the tournament lock** and marks the row `processing`, and only then is the send instruction created, with `reference` = the payout id. It never throws, and a re-run is always safe (see [Claims and retries](#claims-and-retries)).
3. **Settle.** `settle_payout` books one `type='organizer_payout'` row in `payments`, which drains `net_payout_cents`, and sends the "payout processed" email. It is reached from the synchronous response or the webhook (`webhooks/chip/send`), whichever comes first. The other is a no-op on `processed_at`.

What can stop a payout:

| Check | Where | Result |
|---|---|---|
| Tournament cancelled | queue, send | Refused at queue. Terminal at send. |
| Cancellation pending, or a refund not yet settled | queue, send | Refused at queue. Held `pending` at send. |
| Recipient not approved, no entity type, stale agreement, bank account not verified | queue, nominate, accept | Refused. |
| Bank account replaced since queueing | send | Terminal. The retry uses the new account. |
| Requested amount above what is available | queue | Refused, before the recipient is checked. |
| Less than `MIN_PAYOUT_CENTS` available | queue, send | Refused at queue. Terminal at send. |
| CHIP Send balance below payout + fee | send | Budget requested, held `pending`, platform admins emailed. |

## Claims and retries

The claim closes a race. Without it, a cancellation approved after `executePayout`'s block check but before CHIP is called would queue refunds while the transfer still went out. `claim_payout_send` and `review_tournament_cancellation` both lock the tournament, so one of them always sees the other: the claim refuses a cancelled or cancelling tournament, or the cancellation refuses a `processing` payout.

`processing` with no `chip_send_instruction_id` means **claimed, and CHIP may or may not have the instruction**. What happens after a failed send:

| CHIP's answer | Row left | Why |
|---|---|---|
| Insufficient balance; 401; 429 | `pending` (claim released) | CHIP certainly created nothing |
| 408, 5xx, network failure | `processing`, no instruction | The request may have landed |
| Other 4xx | `failed` | Terminal |

A re-run of a claimed row checks nothing and sends the same reference again, which returns the existing instruction if there is one. The claim was the commitment point.

Nothing re-runs a stalled row on its own yet. An admin can, with **Retry send** on `/admin/payouts` or the review page (`POST /api/v1/admin/payouts/[id]/send`), for any approved payout that is `pending` or claimed without an instruction (`canResend`). The Phase 7 sweep (#522) should cover the same rows.

## Early payouts

An organization owner can ask for part of a tournament's revenue before it ends, from `/my/organizations/[orgId]/payouts` (`POST /api/v1/organizations/[orgId]/payouts`). A platform admin approves or rejects it at `/admin/payouts/[id]` (`PATCH /api/v1/admin/payouts/[id]`).

```
ceiling = FLOOR(net_revenue * 50 / 100)            EARLY_PAYOUT_MAX_PCT
cap     = LEAST(available, ceiling - committed)    early_payout_cap
```

`committed` is every early payout awaiting review, in flight or paid. The review page lays this arithmetic out line by line.

1. **Request.** `request_early_payout` locks the tournament, checks `payout.request` itself, and refuses with `EARLY_PAYOUT_NOT_ALLOWED: <code>` from `early_payout_problem` (below), or an amount over the cap or under the minimum. The row is `approval='pending'`, `status='pending'`, and **reserves its amount at once**: `available_payout_cents` counts it. Every platform admin is emailed.
2. **Review.** `review_payout_request` locks the tournament, then the row. Reject records the reason and frees the money. Approve **re-runs every check**, since days may have passed, and re-snapshots the bank account in case the organizer replaced it. It only sets `approval='approved'`: no money moves in that transaction.
3. **Send.** The route then calls `executePayout`, exactly as for an automatic payout, and returns its outcome. The organization is emailed the decision first, then the usual processed/failed email once it settles.

What `early_payout_problem` refuses, in order: tournament cancelled or not published; registration not yet closed; **a beneficiary nominated** (third-party payouts are final-only, since the organizing org would owe any claw-back); a cancellation or refund pending; the organization not eligible to be paid; both requests used; another early request in flight; less than `MIN_PAYOUT_CENTS` payable early. The organizer's dashboard shows the same reason before they ask.

**Two per tournament.** `request_seq` (1 or 2) carries the limit, and `uniq_early_payout_seq_per_tournament` backs it. Only a request awaiting review, in flight or paid holds its slot: a **rejected** one moved no money, so a typo doesn't cost the organizer a request, and a **failed** one moved none either, so the next request takes its seq and is linked from it via `superseded_by`. `uniq_live_early_payout_per_tournament` allows one in flight at a time.

## Cancellation after a payout

Cancelling refunds every confirmed player their full **gross** from the Collect balance, but money already sent to the organizer has left through CHIP Send and there is no automated claw-back. So `review_tournament_cancellation` refuses approval (`CANCELLATION_BLOCKED_BY_PAYOUT`, a 409 that names the shortfall) once an organizer payout has been **paid**, or while one is **being sent** (claimed or out with CHIP). A payout approved but not yet claimed doesn't block it: its claim refuses, and `executePayout` fails it on the cancelled tournament. Recovering the money is a manual `payment_type='adjustment'` row and an ops process; then the cancellation can be approved.

## Emails

| Email | To | When |
|---|---|---|
| Payout processed / failed | Recipient org, and the organizing org if a beneficiary was paid | Settlement |
| Early payout approved / declined | Organizing org | Review |
| Admin payout alert | Every platform admin | Early request filed; payout parked on budget (once per budget request) |
| Payout nomination | Nominated org | Nomination |

Organization emails go to owners, admins and the contact address (`loadOrganizationRecipients`). None of them carries more than the last 4 digits of an account number.

## Deliberate differences from refunds

- **A failed payout is terminal, and a retry is a new row** linked via `superseded_by`. A failed refund stays `pending` for a retry on the same row. CHIP Send dedupes on `reference`, so re-sending the same payout id after a hard failure would return the failed instruction forever.
- **`payments.organization_id` is always the organizing org**, even when a beneficiary is paid, because the summary view groups on it. A row carrying the beneficiary's id would never drain the organizer's balance. The recipient is on `payouts.recipient_organization_id`.
- **`chip_transaction_id` is `send_<id>`.** The unique index on that column spans all payment types, and a Send id is a small integer sharing the namespace with Collect purchase uuids.
- **More settled than available is booked anyway**, flagged `over_payout` and logged at error level. The money has left, so refusing to record it would make the ledger lie.

## CHIP Send behaviour worth knowing

- **Insufficient balance is a 400 in practice, not the documented 403.** The sandbox answers create-send-instruction with `400 {"message":"Balance not enough. Please increase your Send Limit"}`. `ChipSendError.insufficientBalance` covers both.
- 401, 408, 429 and 5xx stay retryable. Other 4xx are terminal.
- **Each successful transfer costs RM1 (`CHIP_SEND_FEE_CENTS`), taken from the Send balance.** The pre-send balance check and the budget request both use payout + fee, or an approved allocation would still leave the payout short.
- A budget request emails every approver, so a re-run won't send another while one is pending. An expired one is replaced.
- **The webhook delivery body is undocumented.** The handler assumes the fields of the `SendInstruction` resource, at the top level or under `data`, and falls back to the recorded amount. Check this against a real delivery.

## Beneficiary nomination

A tournament may nominate another approved organization to receive its payout. `nominate_payout_beneficiary` takes `payout.request` on the organizing org, and `accept_payout_nomination` takes it on the nominee, so a one-sided nomination can't move money. Until accepted, the payout stays with the organizing org.

Both columns are money fields, frozen at the first paid registration, so a nomination still pending at that point lapses. A trigger also refuses any write to them from a user JWT, because the tournaments UPDATE policy has no column restriction. Early payouts are blocked whenever a beneficiary is set. The organizing org stays liable for any claw-back.

## Known limits

- **One automatic payout per tournament** (`uniq_automatic_payout_per_tournament`). An admin paying part of the balance by hand leaves the rest with no way to be paid until something else allows it. The admin screen warns about this.
- `current_organizer_agreement_version()` in SQL has to be bumped alongside `ORGANIZER_AGREEMENT_VERSION`. A test fails if they differ.
- A payout left `processing` by a lost webhook stays reserved until the Phase 7 reconciler exists (#522). One claimed without an instruction can be finished with Retry send; the reconciler should do the same for it, rather than look up an instruction id it doesn't have.
