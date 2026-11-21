# Payout flow (organizer disbursement)

How an organization receives its tournament revenue through **CHIP Send**. As in the [payment](./payment-flow.md) and [refund](./refund-flow.md) flows, money state is enforced in Postgres (SECURITY DEFINER functions + row locks), network calls happen outside those transactions, and settlement is idempotent so the synchronous response and the webhook can't double-book.

Scope: the payout machine and the admin trigger (#520), early payouts and their review (#521), the automatic sweep and its reconcilers (#522). Platform-managed prizes (#523) reuse this machinery and are documented in [prize-flow.md](./prize-flow.md).

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

A re-run of a claimed row checks nothing and sends the same reference again, on the assumption that CHIP then returns the existing instruction if there is one. CHIP requires instruction references to be unique but doesn't document the answer to a repeat, so this is [unverified](./chip-api.md#open-question-repeated-send-instruction-references). The claim was the commitment point.

The [daily run](#the-daily-run) re-runs these rows on its own: every approved `pending` payout each day, and a claimed one once it has been `processing` for `PAYOUT_STUCK_HOURS`. An admin needn't wait for it: **Retry send** on `/admin/payouts` or the review page (`POST /api/v1/admin/payouts/[id]/send`) does the same for any approved payout that is `pending` or claimed without an instruction (`canResend`).

## The daily run

A GitHub Actions schedule (`.github/workflows/organizer-payouts.yml`, 01:00 UTC = 09:00 MYT) POSTs `/api/v1/cron/payouts` with the shared `CRON_SECRET`, as the FIDE ratings job does. Like the refund sweep (`cancellation-refunds.yml`, every 5 minutes) and the FIDE job, it is a GitHub Actions schedule: there is no `pg_cron` and no platform cron. The route runs four passes, in this order.

**First, pending bank accounts** (`registerPendingBankAccounts`, `src/services/payouts/bank-account.ts`). An organization's bank account is registered with CHIP Send once the organization is approved: by the approval itself, or by the organizer's save if it is already approved. Both register after the response (#555), so a slow CHIP never holds up the admin or the organizer. An account can be left `pending` with no verdict in three ways: the registration fails or is cut short (no `chip_bank_account_id`); CHIP answers on the spot but `settle_bank_account_verification` fails after the id was saved; or CHIP's verdict webhook never arrives. This pass re-registers every active, `pending` account of an approved organization, skipping any created in the last `BANK_REGISTRATION_GRACE_MINUTES` (15) so it doesn't race the request still registering it. Posting an account CHIP already has returns its existing record for our `reference` (the row id) with its current status, so a verdict CHIP has reached is settled from that answer and an account still being verified stays `pending`. Overlapping is harmless: CHIP dedupes on the reference, and the settle RPC keeps the first verdict. It runs first so an account CHIP verifies on the spot can be paid by this run's sweep. Every failure is logged with the bank account id.

**Then the three payout passes** from `src/services/payouts/sweep.ts`:

1. **Stuck payouts.** Anything `processing` for more than `PAYOUT_STUCK_HOURS` (24). With an instruction id, the single-instruction `GET /send/send_instructions/{id}` decides: completed or failed is settled exactly as the webhook would settle it, and anything else is left alone. Never the list endpoint, which CHIP caches for an hour. Claimed with no instruction, it is resumed through `executePayout`, which sends the same reference again. Without this pass a dropped webhook would leave a payout `processing` forever, still reserving its money.
2. **Pending payouts.** Every approved, unsettled `pending` payout goes back through `executePayout`. That sends a payout parked on budget once the allocation has been approved and the balance has landed, without emailing approvers again while it is still waiting, and re-checks a payout held by a block or a lapsed recipient.
3. **The sweep.** `list_payable_tournaments(PAYOUT_HOLD_DAYS, MIN_PAYOUT_CENTS)` returns every tournament due an automatic payout. Each is queued (`queue_payout`, `kind='automatic'`, no amount, no requester) and sent, `PAYOUT_CONCURRENCY` at a time. The sweep runs last so a payout it parks on budget isn't retried straight away.

Per-payout failures are counted and the run moves on. The response gives each payout pass's counts in `executePayout`'s terms (`sent`, `paid`, `failed`, `awaiting_budget`, `blocked`, `skipped`, `error`), plus `swept` and `queued` for the sweep, and `bankAccounts` in registration terms (`checked`, `verified`, `rejected`, `pending`, `skipped`, `error`). A pass that can't load its work list makes the run a 500, so the scheduled job shows as failed, but the other passes still run.

**Last, the prize award passes** (`src/services/prizes/sweep.ts`): the same stuck reconciler and pending retry for prize awards, reported as `stuckPrizes` and `retriedPrizes`. See [prize-flow.md](./prize-flow.md#the-daily-run).

**When a tournament is due.** `tournament_end_instant` is local midnight after `end_date` in the tournament's own `timezone`, as an absolute instant: `(end_date + 1)::timestamp AT TIME ZONE timezone`. A tournament is payable once that plus three days has passed, so a GMT+9 venue is paid an hour before a GMT+8 one with the same end date. It is one instant comparison: no calendar date crosses from Node, and `current_date` (the server's UTC date) is never used. The function has a `COALESCE` seam for tournament schedules, which are planned and not built: when they land, the last session's `ends_at` goes first, and every caller is already correct.

**What the sweep lists.** Published; past its end instant plus the hold; no cancellation under review or refund unsettled (`tournament_payout_block_reason`); recipient payable (`payout_recipient_problem`); no payout of either kind in flight, a rejected early request aside; no live automatic payout (a failed one is retried); at least the minimum available. These are the rules `queue_payout` applies, so a listed tournament is one it accepts unless something changed in between, which it refuses itself. A tournament left off because its recipient can't be paid still shows on the admin candidates list with the reason.

**Re-running is always safe**, on four independent layers: `queue_payout`'s `ON CONFLICT DO NOTHING`, the sweep's two in-flight filters, CHIP's `reference` uniqueness ([unverified](./chip-api.md#open-question-repeated-send-instruction-references) for send instructions), and `settle_payout`'s `processed_at` no-op.

## Early payouts

An organization owner can ask for part of a tournament's revenue before it ends, from `/my/organizations/[orgId]/payouts` (`POST /api/v1/organizations/[orgId]/payouts`). A platform admin approves or rejects it at `/admin/payouts/[id]` (`PATCH /api/v1/admin/payouts/[id]`).

```
ceiling = FLOOR(net_revenue * 50 / 100)            EARLY_PAYOUT_MAX_PCT
cap     = LEAST(available, ceiling - committed)    early_payout_cap
```

`committed` is every early payout awaiting review, in flight or paid. The review page lays this arithmetic out line by line.

1. **Request.** `request_early_payout` locks the tournament, checks `payout.request` itself, and refuses with `EARLY_PAYOUT_NOT_ALLOWED: <code>` from `early_payout_problem` (below), or an amount over the cap or under the minimum. The row is `approval='pending'`, `status='pending'`, and **reserves its amount at once**: `available_payout_cents` counts it. Every platform admin is emailed.
2. **Review.** `review_payout_request` locks the tournament, then the row. Reject records the reason and frees the money. Approve **re-runs every check**, since days may have passed, and re-snapshots the bank account in case the organizer replaced it. It only sets `approval='approved'`: no money moves in that transaction.
3. **Send.** The route then calls `executePayout`, exactly as for an automatic payout, and returns its outcome. The organization is emailed the decision first, then the usual processed/failed email once it settles. Both go out after the response; `inOrderAfterResponse` keeps that order when CHIP settles the transfer synchronously.

What `early_payout_problem` refuses, in order: tournament cancelled or not published; **a beneficiary nominated** (third-party payouts are final-only, since the organizing org would owe any claw-back); a cancellation or refund pending; the organization not eligible to be paid; both requests used; another early request in flight; less than `MIN_PAYOUT_CENTS` payable early. The organizer's dashboard shows the same reason before they ask. Registration may still be open: since #663 an early payout can be requested before entries close, and the cap and claw-back carry the risk.

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

- **A failed payout is terminal, and a retry is a new row** linked via `superseded_by`. A failed refund stays `pending` for a retry on the same row. CHIP requires a send instruction's `reference` to be unique, so the same payout id can't be sent again after a hard failure.
- **`payments.organization_id` is always the organizing org**, even when a beneficiary is paid, because the summary view groups on it. A row carrying the beneficiary's id would never drain the organizer's balance. The recipient is on `payouts.recipient_organization_id`.
- **`chip_transaction_id` is `send_<id>`.** The unique index on that column spans all payment types, and a Send id is a small integer sharing the namespace with Collect purchase uuids.
- **More settled than available is booked anyway**, flagged `over_payout` and logged at error level. The money has left, so refusing to record it would make the ledger lie.

## CHIP Send behaviour worth knowing

- **Insufficient balance is a 400 in practice, not the documented 403.** The sandbox answers create-send-instruction with `400 {"message":"Balance not enough. Please increase your Send Limit"}`. `ChipSendError.insufficientBalance` covers both.
- 401, 408, 429 and 5xx stay retryable. Other 4xx are terminal.
- **Each successful transfer costs RM1 (`CHIP_SEND_FEE_CENTS`), taken from the Send balance.** The pre-send balance check and the budget request both use payout + fee, or an approved allocation would still leave the payout short.
- A budget request emails every approver, so a re-run won't send another while one is pending. An expired one is replaced, and CHIP's `expiry_reason` is logged: the settlement balance no longer covered it, the 12:00 PM (MYT) approval cut-off passed, a newer request superseded it, or the settlement is on hold.
- **Rate limits are per API key, per 5 minutes:** 100 send instructions, 60 bank account registrations, 60 budget requests, and 300 for everything else under `/api/send`. A `429` releases the claim, so the payout goes back to `pending` for the next run. The daily run sends `PAYOUT_CONCURRENCY` at a time, which stays far below these limits at today's volume. See CHIP's [rate limits](https://docs.chip-in.asia/chip-send/api-reference/rate-limits).
- **The webhook** settles from the instruction's `state` and falls back to the recorded amount when CHIP's is unusable. See [chip-webhook.md](./chip-webhook.md#chip-send-webhook).

## Beneficiary nomination

A tournament may nominate another approved organization to receive its payout. `nominate_payout_beneficiary` takes `payout.request` on the organizing org, and `accept_payout_nomination` takes it on the nominee, so a one-sided nomination can't move money. Until accepted, the payout stays with the organizing org. The nominee can instead decline a pending nomination (`decline_payout_nomination`, same permission), which clears it; an accepted one can only be withdrawn by the organizer. Nominating emails the nominee's payout managers, and the nominee's answer emails the organizing org's: accepted (the payout now goes to the nominee) or declined (it stays with the organizer). A repeated accept emails no one (#562).

Both columns are money fields, frozen at the first paid registration, so a nomination still pending at that point lapses. They also lock when the tournament starts, like every other field in the edit policy ([tournament-editing.md](./tournament-editing.md)): from the start date, nominating, withdrawing, accepting and declining are all refused, and the nominee's pending list leaves the nomination out (#594). A trigger also refuses any write to them from a user JWT, because the tournaments UPDATE policy has no column restriction. Early payouts are blocked whenever a beneficiary is set. The organizing org stays liable for any claw-back.

## Known limits

- **One automatic payout per tournament** (`uniq_automatic_payout_per_tournament`). An admin paying part of the balance by hand leaves the rest with no way to be paid until something else allows it. The admin screen warns about this.
- `current_organizer_agreement_version()` in SQL has to be bumped alongside `ORGANIZER_AGREEMENT_VERSION`. A test fails if they differ.
- A bank account whose registration or settlement failed, or whose verdict webhook was lost, stays `pending` until the next daily run, unless the organizer re-saves it. Nothing can be paid to it until then.
- A payout left `processing` by a lost webhook stays reserved until the daily run finds it, up to `PAYOUT_STUCK_HOURS` plus a day. Retry send can't finish one that has an instruction; only the reconciler asks CHIP about it.
- **The end instant ignores the schedule.** Until tournament schedules exist, a tournament ends at midnight after its `end_date`, even if its last round finished in the afternoon. The payout is at most a day later than it would be with the schedule.
