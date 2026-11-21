# 0014. What a prize declaration must hold

- Status: Accepted
- Date: 2026-11-21
- Issue: #523, #675

## Context

[prize-flow](../wiki/prize-flow.md) records the governing rules: entry
fees never fund prizes, and the platform never pays out prize money it hasn't
collected. A few rules about the shape of `tournaments.prizes` sit underneath
them and are checked at publish.

## Decision

In `src/lib/tournaments/prize-funding.ts`, used by
`src/lib/tournaments/publish-validation.ts`:

- **No entry-fee source exists.** `PrizeFundingSource` is `sponsor`, `grant`
  or `organizer`, deliberately without `entry_fees`, so the rule is in the
  type and not only in a check. Every prize with money names its funder.
- **An empty category is a placeholder, not a promise.** A category with no
  prize entries needs no source, and doesn't count as a declared category.
- **Special prizes can't stand alone** (`validatePrizeStructure`). "Best
  Female Player" means the best female among the ranked finishers, so a
  tournament with special prizes must also declare the category they qualify.
- **Funders are matched by name**, ignoring case and outer spaces
  (`funderKey`). `declaredFunders` adds up each funder's share in the order
  they first appear, and is the twin of `declared_prize_funders` in
  `006_payment_functions.sql`, which decides what each funder is asked for.
- **A platform-distributed pool needs an address for every funder**
  (`validateFunderContacts`), because publishing sends each of them a payment
  link. The addresses are private, so they live in `prize_funder_contacts`,
  not in `tournaments.prizes`, which anyone can read once the tournament is
  listed.

## Consequences

- Changing how funder shares are computed means changing
  `declaredFunders` and `declared_prize_funders` together.
