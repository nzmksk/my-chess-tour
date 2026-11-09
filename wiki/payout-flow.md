# Payout flow (organizer disbursement)

How an organization receives its tournament revenue through **CHIP Send**. As in the [payment](./payment-flow.md) and [refund](./refund-flow.md) flows, money state is enforced in Postgres (SECURITY DEFINER functions + row locks), network calls happen outside those transactions, and settlement is idempotent so the synchronous response and the webhook can't double-book.

Scope: the payout machine and the admin trigger (#520). Early payouts and their review are #521, the automatic sweep is #522, platform-managed prizes are #523.

## What is owed

`tournament_payout_summary` is a pure ledger projection:

```
net_payout_cents         = (net_registration - net_refunded) - total_payouts
prize_pool_balance_cents = total_prize_funding - total_prizes
```

Prizes are not in the first line. Entry fees never fund prizes, so prize money is ring-fenced in the second.

The view only subtracts **paid** payouts. How much may leave right now is `available_payout_cents(tournament, exclude_payout)`, which also subtracts payouts in flight. Every call site uses it. It closes the window in which two payouts could both see the same money.

## The flow

1. **Queue.** `queue_payout` locks the tournament, refuses if anything is in the way (below), resolves the recipient and its verified bank account, clamps the amount to what is available, and inserts the row. A live automatic payout already there means it returns NULL. This row is what reserves the money.
2. **Send.** `executePayout` (`src/services/payouts/execute.ts`) re-checks blocks and the bank account, re-clamps the amount, and creates the send instruction with `reference` = the payout id. It never throws: anything transient leaves the row `pending` and safe to re-run.
3. **Settle.** `settle_payout` books one `type='organizer_payout'` row in `payments`, which drains `net_payout_cents`, and sends the "payout processed" email. It is reached from the synchronous response or the webhook (`webhooks/chip/send`), whichever comes first. The other is a no-op on `processed_at`.

What can stop a payout:

| Check | Where | Result |
|---|---|---|
| Tournament cancelled | queue, send | Refused at queue. Terminal at send. |
| Cancellation pending, or a refund not yet settled | queue, send | Refused at queue. Held `pending` at send. |
| Recipient not approved, no entity type, stale agreement, bank account not verified | queue, nominate, accept | Refused. |
| Bank account replaced since queueing | send | Terminal. The retry uses the new account. |
| Less than `MIN_PAYOUT_CENTS` available | queue, send | Refused at queue. Terminal at send. |
| CHIP Send balance below payout + fee | send | Budget requested, held `pending`. |

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
- A payout left `processing` by a lost webhook stays reserved until the Phase 7 reconciler exists (#522).
