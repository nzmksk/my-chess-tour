# Tournament editing (what can change, and when)

Which tournament fields an organizer can still change at each point in a tournament's life (issue #536). The rule is written once, in `src/lib/tournaments/edit-policy.ts` (`LOCKS_AT`); everything else follows that module, so change the policy there and nowhere else.

## Stages

A tournament moves through these stages, in this order. A field locked at one stage stays locked at every later one.

| Stage | When | What it means for editing |
|---|---|---|
| `draft` | `status = 'draft'` | Everything is editable. Placeholder dates don't count as "past". |
| `published` | published (or `pending_funding`, a platform-distributed tournament waiting for its prize pool), start date not reached, no paid registration | Everything is editable, but the tournament has to **stay publishable** (see below). A prize edit on a platform-distributed pool re-asks the funders ([prize-flow.md](./prize-flow.md#keeping-the-requests-in-line-with-the-prizes)). |
| `paid` | published, start date not reached, at least one `payments` row with `type='registration'` and `status='paid'` | What the player paid for is locked. Capacity can only go up. |
| `ongoing` | the venue's today is between the start and end dates | Only the description is editable. |
| `completed` | the venue's today is after the end date | Nothing is editable. |
| `cancelled` | `status = 'cancelled'` | Nothing is editable. |

"Today" is always today **at the venue** (`getTodayInTimeZone(tournament.timezone)`), never the server's or the reader's. A tournament can reach `ongoing` without ever being `paid` (a free event, or nobody registered). Because the stages are ordered, it's still treated as past `paid`.

## Field matrix

✓ = editable, ↑ = may only increase, ✗ = locked.

| Field | draft | published | paid | ongoing | completed / cancelled |
|---|---|---|---|---|---|
| `description` | ✓ | ✓ | ✓ | ✓ | ✗ |
| `name` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `venue_name`, `venue_address` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `registration_deadline` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `venue_country`, `venue_state` (and the derived `timezone`) | ✓ | ✓ | ✗ | ✗ | ✗ |
| `start_date`, `end_date` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `format`, `time_control` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `is_fide_rated`, `is_mcf_rated` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `restrictions` (eligibility) | ✓ | ✓ | ✗ | ✗ | ✗ |
| `max_participants` (capacity) | ✓ | ✓ | ↑ | ✗ | ✗ |
| `entry_fees`, `prizes` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `commission_rate`, `organizer_commission_pct` (not organizer-editable through the API at all) | ✓ | ✓ | ✗ | ✗ | ✗ |
| payout beneficiary (nomination) | ✓ | ✓ | ✗ | ✗ | ✗ |

### Why

- **At the first payment**, the fields that define what the player bought into lock: the price and prizes, who receives the money, when and where it runs, what kind of event it is, and who may enter. Changing any of them rewrites a transaction that has already happened. Tightening eligibility could disqualify someone who already paid. Moving the dates could make the event impossible for them to attend. The venue country decides which payout rails the money moves on. **A tournament that has to move after taking payment is a cancellation with refunds** (see [refund-flow.md](./refund-flow.md)), not an edit.
- **Capacity can still go up after the first payment, but not down.** More places harms nobody who has paid, and lets an organizer whose event sells out open more. Fewer places could leave a paid player without a seat. Once the tournament starts, registration has closed, so capacity locks with everything else. The rule lives in `INCREASE_ONLY_FROM` in the policy module; `isChangeAllowed` combines it with the locks.
- **Capacity never goes below the seats already taken**, at any stage (#591). Settlement doesn't re-check capacity, because a player mid-checkout was promised the seat when the hold was taken. So before this, an organizer could lower capacity under live holds and all of them would still confirm: five players against a capacity of three. The floor is confirmed registrations plus live holds. It matters before the first payment; after it, increase-only already covers it.
- **Cosmetic fields stay editable until the start**: correcting a typo in the name, or moving to another hall at the same venue, doesn't change what anyone paid for. The registration deadline can still move too, because extending or shortening it doesn't touch an existing entry (and `chk_registration_deadline` keeps it on or before the start date).
- **Once started**, only the description is editable, so it can carry notices (pairings links, changes on the day).
- **Ended and cancelled** tournaments are records.

Nothing locks *at* publish. What publishing adds is the publishable bar below.

## Published tournaments stay publishable

A published tournament (`status = 'published'`) is checked after every edit against the same validator the publish route uses (`validatePublishable`, `src/lib/tournaments/publish-validation.ts`). An edit that blanks a required field or moves a date into the past is refused with a **422** listing what it broke.

- Only problems **the edit introduces** are reported. A listing published before a rule existed (say, prize funding) can still have its description fixed without first being brought up to date.
- The "must be in the future" checks only apply to a date **the edit changes**. A deadline that has already passed is a closed registration, and resending it unchanged is not an error.

## Enforcement

| Layer | Where | Covers |
|---|---|---|
| Database (authority for the `paid` stage) | `guard_tournament_paid_fields` trigger, `db/migrations/003_functions_triggers.sql` | Every `paid`-locked column, and a capacity decrease, for any writer (service role, SQL editor). Raises `P0001` naming the columns. |
| Database, capacity floor (every stage) | `guard_tournament_seats_taken` trigger, same file | A capacity below the seats already taken: confirmed registrations plus checkout holds still inside the 10-minute window (`count_taken_seats`, the count `assert_tournament_capacity` uses). Raises `P0001` with a `CAPACITY_BELOW_TAKEN: <n>` sentinel. |
| API (readable errors, the date stages) | `PATCH /api/v1/organizations/[orgId]/tournaments/[id]` | Every stage. **409** `CONFLICT`, with `message` saying why and `details` listing the refused field names. **422** for the publishable bar, and for a capacity below the seats taken ("5 places are already taken, so capacity can't go below 5."), mapped from the trigger's error rather than checked first. |
| API, payout beneficiary | `PUT .../tournaments/[id]/beneficiary` (nominate, withdraw) and `POST`/`DELETE .../nominations/[tournamentId]` (accept, decline), via `beneficiaryLockResponse` in `src/app/api/v1/organizations/_lib/beneficiary-lock.ts` | The date stages: from the start date, all four are refused with a **409** and `lockReason(stage)`. The trigger covers `paid` for all four, and the RPCs refuse a cancelled tournament. The nominee's pending list (`GET .../nominations`) leaves out the ones the dates have locked. |
| Edit wizard (no surprises) | `src/app/my/organizations/[orgId]/tournaments/create/_components/` | Takes `paid` from the manage-data loader's `hasPaidRegistration`, which uses the same helper as the PATCH route (`hasPaidRegistration` in `src/services/payments/paid-registration.ts`), so the two can't disagree. Disables locked fields, explains why in a banner, and leaves locked fields out of the PATCH body. After a payment the capacity input won't go below the saved capacity (`savedCapacity`, passed from the server, never from sessionStorage). The capacity input doesn't know the seats taken (holds change by the minute, so a number from page load would be stale); a decrease below them comes back as the route's 422 message. The edit page redirects to the manage page once nothing is editable, and the manage page only offers "Edit Tournament" while something is. Cancel leaves without saving and clears the wizard's sessionStorage, so the next visit starts from what's saved rather than restoring abandoned edits. |

The date-based stages (`ongoing`, `completed`) are deliberately **not** in the database: they depend on today at the venue, and a second definition of that in SQL would drift from `getTodayInTimeZone()`.

### "Changed", not "present"

Both the trigger and the route refuse a locked field only when its value **changes** (for capacity after payment, only when it goes down). A client that resends a locked field at its current value is fine. The route compares jsonb fields structurally (key order ignored, like `IS DISTINCT FROM` on jsonb) and the registration deadline as an instant, so `…Z` and `…+00:00` for the same moment are equal. The wizard avoids the question by not sending locked fields at all.

## Known limits / follow-ups

- **Rescheduling a paid tournament** isn't possible by editing. Today it's a cancellation (refunds) and a new tournament. A proper reschedule flow would need player notification and a refund-or-keep choice (#592).
- **Raising capacity doesn't promote anyone.** There's no registration waiting list today, so more places simply means the checkout stops reporting "full" (#590).
