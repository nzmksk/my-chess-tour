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

Funding is automatic. The organizer never types in an amount or forwards a link.

1. **Declare.** In the wizard's Prizes step, every prize with money names its funder (`prizes[].funding.funder_name`). When the platform distributes the prizes, the step also asks for each funder's email. Those addresses are saved through their own route (`PUT .../prize-funder-contacts`) into `prize_funder_contacts`, **never into `tournaments.prizes`**. That document is readable by anyone once the tournament is listed (the "Public can view published tournaments" policy), and a sponsor's address is not public. A funder is matched by name, ignoring case and surrounding spaces, so "ACME" on one category and "acme " on another are one sponsor with one link.
2. **Publish.** `POST .../publish` refuses a platform-distributed pool unless every funder has an address. It then moves the tournament to **`pending_funding`** instead of `published` (below), and calls `syncPrizeFundingRequests` (`src/services/prizes/funding-requests.ts`).
3. **Ask.** The sync has two halves.
   - **Rows.** `reconcile_prize_funding_requests` works under the tournament lock and keeps **one open `prize_fundings` request per funder** for what that funder still owes (their declared share, `declared_prize_funders`, minus what they have paid).
   - **Network.** Outside the transaction, the app creates each new request's CHIP Collect purchase (`reference` = the row id, no due date, since a sponsor may take days). It then emails the funder `prize-funding-request`, which shows their amount, the prizes it funds and the link.
4. **Pay.** The sponsor pays on CHIP and lands on `/prize-funding/thank-you`.
5. **Settle.** The **existing** Collect webhook (`webhooks/chip/route.ts`) looks for a `prize_fundings` row **before** the registration path: by purchase id, then by reference. When it finds one, `settle_prize_funding` books one `type='prize_funding'` ledger row and marks the contribution paid. It never reaches `settle_registration_payment`. It follows the same rules as registrations:
   - an amount that doesn't match is left pending for a person to look at;
   - a late `paid` beats an earlier failure;
   - a repeat delivery does nothing.

   When this payment completes the pool, the tournament is **listed** (see below).

### Keeping the requests in line with the prizes

The reconcile runs again whenever what is owed might have changed: a prize edit on a tournament that is out of draft, saving funder contacts, an approved cancellation, the organizer's **Retry** on the manage page, and the daily run. For each funder:

| What it finds | What it does |
|---|---|
| The funder owes nothing (fully paid, or dropped from the prizes) | Cancels every open request |
| An open request already asks for exactly what is owed, at the current address | Keeps it, and cancels any others |
| Anything else (the share or the address changed, or the last payment failed) | Cancels the open requests and asks again with a fresh link |
| No address on file | Creates nothing. The funder is reported in `missing_contacts` and the manage page warns about them |

A cancelled request (`cancelled_at`) has its CHIP purchase cancelled too, as a best effort. If it is paid anyway, the money is booked. Real money wins, and any surplus is residual (below).

If CHIP fails while a link is being created, the request stays open with no link, and the next sync retries it. A link created for a request that was cancelled or linked in the meantime is cancelled rather than kept.

### Pending funding: unlisted until funded

A platform-distributed tournament with prize money **is not visible to the public until its pool is fully funded** (`funded >= declared`). Otherwise players would see, and pay into, an event whose advertised prizes have no money behind them.

- **Publishing** sets `status = 'pending_funding'`. The slug, `published_at` and `registration_closed_at` are stamped as for any publish, but the "Public can view published tournaments" policy and every public query read `status = 'published'` only, so the tournament stays hidden. The organizer sees it as "Awaiting Prize Funding". They can still edit it under the published rules, and they can request its cancellation (a sponsor who never pays is the usual reason). There is no registration to close.
- **Listing.** `release_funded_tournament` moves it to `published` once the pool is complete. It is called by `settle_prize_funding` (reported as `went_live`) and at the end of every reconcile. That covers an edit that lowers the prizes to what has been paid, and a switch to the organizer paying the winners before anything was paid in. The webhook (or route) then refreshes the public pages, and `tournament-listed` tells the organization's owners and admins.
- **Organizer-paid tournaments** (`distribution = "organizer"`) and tournaments with no prize money are listed the moment they are published, as before.

Taking distribution away from the platform is refused once any sponsor has paid in, because that money is held for the winners.

### The registration gate (backstop)

Once listed, a tournament can still have its prizes **raised** until the first paid registration freezes them. That reopens the gap. The reconcile asks the funders for the top-up, and registration is paused until it is paid. Three places enforce this:

- the checkout route asks `prize_pool_blocks_registration` first and answers `422 PRIZE_POOL_NOT_FUNDED`;
- `create_registration_with_payment` and `start_new_payment_attempt` refuse the same way, as the backstop. They check under the tournament row lock, so a checkout and a prize edit happening together always see each other (`supabase/tests/prize_pool_checkout_race.sql`);
- the public page reads the gate live (outside the tournament cache) and shows "Opens Once Prizes Are Funded".

**A player already paying is protected too.** The gate runs when a checkout starts, but `settle_registration_payment` doesn't run it again, since it can't refuse money already taken. Without a further rule, a player holding a live CHIP link could pay after the prizes were raised and be confirmed against a pool that no longer covers them. So while any checkout hold is live (the 10-minute window, after which CHIP's `due_strict` makes the link unpayable), `guard_tournament_prizes_in_checkout` (003) refuses a prize change that would leave the pool short. The edit route answers `409` and asks the organizer to try again in 10 minutes. A change the money already paid in still covers is allowed, and organizer-paid tournaments are never held.

One case is left uncovered. A payment made just before its link lapsed may have its webhook arrive after a raise that was saved once the window had passed. That player paid while the pool still covered the prizes. The raise still asks the funders for the top-up and pauses further registration.

## Money out: awards

1. **Enter.** After the event (from the last day of play, in the venue's timezone), the organizer names each winner on the manage page: `POST .../prize-awards` → `enter_prize_award`. The winner must hold a **confirmed registration** for the tournament. The prize must be one the tournament declares: a category's place, or a special prize by name. Several awards may share one prize (a tie), but together they can't exceed its declared amount, and the same player can't hold one prize twice. Entering reserves nothing and emails every platform admin.
2. **Review.** A platform admin checks the award against the arbiter's results at `/admin/prizes` (`PATCH /api/v1/admin/prize-awards/[id]`). A wrong name here would be an irreversible transfer. `review_prize_award` is **the hard guard**. Under the tournament row lock it refuses unless the pool is fully funded and
   ```
   amount <= available_prize_pool_cents(tournament, this award)
   ```
   Every approval takes the same lock and reads the reservations committed before it, so concurrent approvals can't together exceed the collected pool (`supabase/tests/prize_award_review_race.sql` runs two at once). Approving reserves the money and emails the winner (`prize-awarded`): the account it will go to, or a request to add or fix their bank details.

   **Withdrawing (#611).** Until an admin reviews it, the organizer can take an award back from the manage page (`POST .../prize-awards/[awardId]/withdraw` → `withdraw_prize_award`, `payout.request`), for a wrong winner or amount. A withdrawn award is stored as `approval = 'rejected'` with `withdrawn_at`/`withdrawn_by` and no reviewer, so it leaves the review queue at once, frees its prize, and the corrected award can be entered straight away. The function takes the tournament lock and then the award, as review does, so a withdrawal and an approval of the same award run one after the other: an approved award can't be withdrawn (`PRIZE_AWARD_NOT_WITHDRAWABLE: approved`), and a withdrawn one can't be reviewed (`PRIZE_AWARD_WITHDRAWN`). `supabase/tests/prize_award_withdraw_race.sql` runs both orders. Reversing an approved award stays an admin decision. The audit trail records the withdrawal as an update under `prize-award.withdraw`.
3. **Send.** `executePrizeAward` (`src/services/prizes/execute.ts`) is the `executePayout` twin. It has the same outcomes (`sent`, `paid`, `failed`, `awaiting_budget`, `blocked`, `skipped`, `error`), the same claim discipline (`claim_prize_award_send` re-checks the tournament and the pool under the lock and snapshots the winner's verified account), the same retry rules (`src/services/payouts/send-errors.ts`) and the same budget parking. `reference` is the award id.
4. **Settle.** `settle_prize_award` books one `type='player_prize'` row (`user_id` = the winner, `chip_transaction_id` = `send_<instruction id>`), from the synchronous response or the Send webhook, whichever comes first. The winner gets `prize-paid` with CHIP's receipt. An over-settled award is booked anyway and logged at error level, as for payouts.

A **failed** award is terminal, as a failed payout is. CHIP requires a send instruction's `reference` to be unique, so the award id can't be sent again: the organizer enters the winner again (failed and rejected awards free their prize) and an admin approves the new row. **Retry send** on `/admin/prizes` re-runs an approved award that hasn't gone out.

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
- when an admin confirms an account held because the bank's holder name didn't match the one the winner gave, or rejects it, which emails the winner as a CHIP rejection does ([Who the account belongs to](./payout-flow.md#who-the-account-belongs-to));
- on the daily run.

### Dependents' prizes (#718)

`prize_awards.user_id` is always the winner. Whose account the money goes to is decided by `prize_payees()` (migration `20261124210000`), the one rule that the claim, the award lists and the emails all read:

- **A minor** (an active guardianship with basis `minor`) holds no bank details: `set_player_bank_account` refuses them with `MINOR_DEPENDENT`. Their prize goes to a guardian's own `player_bank_accounts` row. That is the guardian with a verified account, else one who has an account, else the earliest guardianship. A guardian saving or verifying their account sends their minor dependents' waiting prizes too. The awarded email tells the guardian who is paid that the money goes to their account, or asks them to add one.
- **An adult with a helper** (`authorised` / `appointed`) keeps their own row. The helper enters it with `PUT /api/v1/me/dependents/[id]/bank-account`, under the financial consent they recorded (#717). The row records `entered_by`, and the holder-name check compares CHIP's holder name with **the player's name**, never the holder the helper typed. The route also refuses a holder that isn't the player (`HOLDER_NOT_PLAYER`).

`claim_prize_award_send` records `payee_user_id` and `payee_reason` (`winner` or `guardian_of_minor`) next to the snapshotted `bank_account_id`. CHIP Send is given the payee's email. A managed winner with no email or contact email falls back to the support address rather than never sending.

## The daily run

`POST /api/v1/cron/payouts` (see [payout-flow.md](./payout-flow.md#the-daily-run)) ends with three prize passes. Their counts are `stuckPrizes`, `retriedPrizes` and `prizeFunding`:

1. **Stuck awards** (`src/services/prizes/sweep.ts`). An award `processing` for over `PAYOUT_STUCK_HOURS` is handled one of two ways. One with an instruction is settled from CHIP's single-instruction GET. One claimed without an instruction is resumed.
2. **Pending awards.** Every approved, unsettled `pending` award goes back through `executePrizeAward`. This is also what registers a waiting winner's account.
3. **Funding** (`sweepPrizeFundingRequests`). Every `pending_funding` tournament is reconciled. That asks again, with a fresh link, any sponsor whose payment failed, and retries any link CHIP refused at publish. Then any link still missing elsewhere is created (a top-up on a listed tournament).

## Residual funds: returned to the funders

**Decision (#523):** any part of a pool that isn't awarded (a prize with no eligible winner, a forfeit, anything paid in beyond the declared prizes) is **returned to the funders, pro rata to what each paid in, less transfer costs, once every award for the tournament has been settled**. A prize unclaimed twelve months after the tournament ends is treated the same way, and a tournament cancelled before results are certified returns the whole pool. Section 9 of the Organizer Agreement says exactly this (version 2026-11-20). If the two ever disagree, the agreement is what will be held against us, so change them together.

The return itself is an **operations step today**, not automated. Once the remaining `prize_pool_balance_cents` is known, an admin refunds each funder's CHIP purchase (partial refunds are supported) and records the money with a `payment_type='adjustment'` row, so the pool balance goes to zero. Automating this, and the full return on cancellation, is a follow-up.

## Emails

| Email | To | When |
|---|---|---|
| Prize fund payment | Each funder | Publish; again with a fresh link when their share or address changes, or their payment failed |
| Tournament is open | Organization owners and admins | The payment that completes the pool lists the tournament |
| Prize awarded | Winner | Admin approval; again if their account is rejected while the award waits |
| Prize paid | Winner | Settlement, with CHIP's receipt |
| Admin alert: prize winners to review | Every platform admin | A winner is entered |
| Admin alert: awaiting budget | Every platform admin | An award is parked on CHIP Send budget |

Best-effort and after the response, following the `Promise.allSettled` discipline in `src/services/email/email.ts`. **No email carries more than the last 4 digits of an account number.**

## Known limits

- Returning residual funds, and the whole pool on cancellation, is manual (above). Cancelling withdraws the open payment links automatically; money already paid in is returned by hand.
- A tournament still waiting for funding when its registration deadline passes is listed once funded, but with registration already closed. The organizer should move the deadline or cancel.
- A minor's prize goes to one guardian's account, chosen by `prize_payees()`. Guardians can't pick between themselves.
