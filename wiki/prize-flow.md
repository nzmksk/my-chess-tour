# Prize flow (platform-managed prize pool)

How MY Chess Tour collects a tournament's prize money from its sponsors and pays the winners (#523). It is **opt-in per tournament**: `prizes.distribution = "platform"`. By default (`"organizer"`) the organizer pays their own winners off-platform and none of this applies.

> **The governing rule: the platform never pays out prize money it has not collected.** Prize money is ring-fenced from organizer revenue at every level: its own ledger types, its own balance, and a hard funding check before any winner is paid.

Entry fees never fund prizes (`src/lib/tournaments/prize-funding.ts`). Every declared prize names an external source (sponsor, grant, the organizer's own funds), and this flow is the platform acting as escrow and paymaster for that externally funded pool. As in the [payout](./payout-flow.md) and [refund](./refund-flow.md) flows, money state lives in Postgres (`SECURITY DEFINER` functions, row locks), network calls happen outside those transactions, and settlement is idempotent.

## The ledger

```
funded    = prize_funding paid in             tournament_payout_summary
paid out  = player_prize paid out             tournament_payout_summary
balance   = funded - paid out                 prize_pool_balance_cents
reserved  = APPROVED awards not yet settled   prize_awards
available = balance - reserved                available_prize_pool_cents
```

`net_payout_cents` never reads either prize type, so prize money moves the organizer's revenue by nothing, in either direction. Both ledger rows carry the **organizing** org's id, like every `payments` row, so they group with the tournament in the summary view. `prize_pool_position(tournament)` returns all of the above plus `declared_cents` and `fully_funded`. Every caller reads it from there.

## Money in: funding

1. **Ask.** The organizer (owner, `payout.request`) fills in a sponsor's name and email on the tournament's manage page: `POST /api/v1/organizations/[orgId]/tournaments/[id]/prize-funding`. That records a `prize_fundings` row and creates a CHIP Collect purchase with `reference` = the row id and **no due date** (a sponsor may take days). The response is the checkout link, which the organizer forwards. An omitted amount means everything the pool still needs. A larger amount is refused, so a pool is never deliberately over-funded. A pool may have several sponsors, each with their own link.
2. **Pay.** The sponsor pays on CHIP and lands on `/prize-funding/thank-you`.
3. **Settle.** The **existing** Collect webhook (`webhooks/chip/route.ts`) looks for a `prize_fundings` row (by purchase id, then by reference) **before** the registration path. When it finds one, `settle_prize_funding` books one `type='prize_funding'` ledger row and marks the contribution paid. It never reaches `settle_registration_payment`. It follows the same rules as registrations: a mismatched amount is left pending for a person, a late `paid` wins over an earlier failure, and a duplicate is a no-op.

### The registration gate

A platform-distributed tournament **may publish before it is funded, but no one can register until the pool is fully funded** (`funded >= declared`). Otherwise players would enter an event whose advertised prizes have no money behind them. The gate is enforced in three places:

- the checkout route asks `prize_pool_blocks_registration` first and answers `422 PRIZE_POOL_NOT_FUNDED`;
- `create_registration_with_payment` and `start_new_payment_attempt` refuse the same way, as the backstop;
- the public page reads the gate live (outside the tournament cache) and shows "Opens Once Prizes Are Funded".

Prizes are a money field, so they freeze at the first paid registration. Before that, raising the declared prizes reopens the gap and closes registration again until it is topped up.

## Money out: awards

1. **Enter.** After the event (from the last day of play, in the venue's timezone), the organizer names each winner on the manage page: `POST .../prize-awards` → `enter_prize_award`. The winner must hold a **confirmed registration** for the tournament. The prize must be one the tournament declares: a category's place, or a special prize by name. Several awards may share one prize (a tie), but together they can't exceed its declared amount, and the same player can't hold one prize twice. Entering reserves nothing and emails every platform admin.
2. **Review.** A platform admin checks the award against the arbiter's results at `/admin/prizes` (`PATCH /api/v1/admin/prize-awards/[id]`). A wrong name here would be an irreversible transfer. `review_prize_award` is **the hard guard**. Under the tournament row lock it refuses unless the pool is fully funded and
   ```
   amount <= available_prize_pool_cents(tournament, this award)
   ```
   Every approval takes the same lock and reads the reservations committed before it, so concurrent approvals can't together exceed the collected pool (`db/tests/prize_award_review_race.sql` runs two at once). Approving reserves the money and emails the winner (`prize-awarded`): the account it will go to, or a request to add or fix their bank details.
3. **Send.** `executePrizeAward` (`src/services/prizes/execute.ts`) is the `executePayout` twin. It has the same outcomes (`sent`, `paid`, `failed`, `awaiting_budget`, `blocked`, `skipped`, `error`), the same claim discipline (`claim_prize_award_send` re-checks the tournament and the pool under the lock and snapshots the winner's verified account), the same retry rules (`src/services/payouts/send-errors.ts`) and the same budget parking. `reference` is the award id.
4. **Settle.** `settle_prize_award` books one `type='player_prize'` row (`user_id` = the winner, `chip_transaction_id` = `send_<instruction id>`), from the synchronous response or the Send webhook, whichever comes first. The winner gets `prize-paid` with CHIP's receipt. An over-settled award is booked anyway and logged at error level, as for payouts.

A **failed** award is terminal, as a failed payout is. CHIP dedupes on `reference`, so the organizer enters the winner again (failed and rejected awards free their prize) and an admin approves the new row. **Retry send** on `/admin/prizes` re-runs an approved award that hasn't gone out.

### What stops an award

| Check | Where | Result |
|---|---|---|
| Not platform-distributed, not published, cancelled, cancellation pending | enter, review | Refused (`PRIZE_AWARD_NOT_ALLOWED: <code>`) |
| Before the last day of play | enter | Refused |
| Winner has no confirmed registration | enter | Refused |
| No such declared prize, or the split would exceed it | enter | Refused |
| Pool not fully funded | review | Refused |
| Award beyond the uncommitted pool | review, claim | Refused at review; held at claim |
| Winner has no account, or it is pending or rejected | send | Held `pending`, money reserved (see below) |
| CHIP Send balance below prize + fee | send | Budget requested, held `pending`, admins emailed |
| Tournament cancelled | claim | Terminal |

There is no minimum. A RM20 prize is a real prize, and the RM1 CHIP fee comes from the platform's Send balance, not from the winner.

## The winner's bank account

Players have their own `player_bank_accounts`, built like `organization_bank_accounts`: a SWIFT code from `src/lib/reference/malaysian-banks.ts`, one active row per player, superseded (`set_player_bank_account`) rather than updated, so any change goes back to `pending`. They are edited in Settings (`PATCH /api/v1/profile/banking`). The full number is never returned. There is no destination-uniqueness index, because siblings' prizes often go to a parent's account.

Registration with CHIP Send reuses `src/services/payouts/bank-account.ts` (`registerPlayerBankAccount`), and the verdict settles through the same `settle_bank_account_verification`, which looks in both tables. **A player's account is not registered when it is saved.** Each registration is a CHIP verification, and most players never win a platform-distributed prize. It is registered the first time an approved award needs it, inside `executePrizeAward`. An award waiting on an account goes out as soon as it can:

- when the winner saves their details (the banking route calls `sendAwardsAwaitingBank` after the response);
- when CHIP verifies the account (the Send webhook hands player verdicts to `onPlayerBankVerdict`; a **rejected** account re-sends the awarded email asking the winner to fix it);
- on the daily run.

## The daily run

`POST /api/v1/cron/payouts` (see [payout-flow.md](./payout-flow.md#the-daily-run)) ends with two prize passes from `src/services/prizes/sweep.ts`. Their counts are `stuckPrizes` and `retriedPrizes`:

1. **Stuck awards.** `processing` for over `PAYOUT_STUCK_HOURS`: one with an instruction is settled from CHIP's single-instruction GET, and one claimed without an instruction is resumed.
2. **Pending awards.** Every approved, unsettled `pending` award goes back through `executePrizeAward`. This is also what registers a waiting winner's account.

## Residual funds: returned to the funders

**Decision (#523):** any part of a pool that isn't awarded (a prize with no eligible winner, a forfeit, anything paid in beyond the declared prizes) is **returned to the funders, pro rata to what each paid in, less transfer costs, once every award for the tournament has been settled**. A prize unclaimed twelve months after the tournament ends is treated the same way, and a tournament cancelled before results are certified returns the whole pool. Section 9 of the Organizer Agreement says exactly this (version 2026-11-18). If the two ever disagree, the agreement is what will be held against us, so change them together.

The return itself is an **operations step today**, not automated. Once the remaining `prize_pool_balance_cents` is known, an admin refunds each funder's CHIP purchase (partial refunds are supported) and records the money with a `payment_type='adjustment'` row, so the pool balance goes to zero. Automating this, and the full return on cancellation, is a follow-up.

## Emails

| Email | To | When |
|---|---|---|
| Prize awarded | Winner | Admin approval; again if their account is rejected while the award waits |
| Prize paid | Winner | Settlement, with CHIP's receipt |
| Admin alert: prize winners to review | Every platform admin | A winner is entered |
| Admin alert: awaiting budget | Every platform admin | An award is parked on CHIP Send budget |

Best-effort and after the response, following the `Promise.allSettled` discipline in `src/services/email/email.ts`. **No email carries more than the last 4 digits of an account number.**

## Known limits

- Returning residual funds, and the whole pool on cancellation, is manual (above).
- An organizer can't withdraw an award awaiting review; an admin rejects it with a reason instead.
- The winner must have a login: an award goes to a confirmed registrant's own `player_bank_accounts`. Guardians and managed players (#504) will widen `can_act_for`, not this flow.
- Rolling out to an existing database: `db/maintenance/apply_prize_pool.sql`, then re-run 007. It drops the old free-text player bank columns, so players re-enter their details.
