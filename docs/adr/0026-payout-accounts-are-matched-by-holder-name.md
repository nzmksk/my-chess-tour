# 0026. Payout accounts are matched by holder name

- Status: Accepted
- Date: 2026-11-22
- Issue: #374, #551

## Context

CHIP Send's bank-account verification checks only that the account number
exists at the bank (#551). It doesn't compare the holder name we send. It
replaces it with the bank's own holder name instead. In the sandbox it
verifies everything except account numbers ending in `0000`. So a `verified`
account proves the number is real, not who owns it, and anyone could save
someone else's valid account number as their payout destination.

## Decision

- **The bank's name is matched against a name the owner can't freely change.**
  For an organization that is its registered name
  (`organization_registered_names`): the SSM/ROS name, or for an individual the
  name on their identity document. It's given at application, checked by the
  admin against the KYB documents, and never edited after approval. An
  organization that applied before the registered name existed falls back to the
  account holder it submitted. For a player, the expected name is the account
  holder they submitted.
- **The match is `holderNamesMatch`** (`src/services/payouts/holder-name.ts`),
  run by `settleBankAccountVerification` before it records CHIP's verdict. Both
  names are normalised the same way:
  - accents and punctuation are dropped, case is ignored and spaces don't count;
  - Malay and Indian patronymic connectors (`BIN`, `BINTI`, `BT`, `A/L`, `A/P`,
    `S/O`, `D/O`, …) and honorifics (`DATO`, `HAJI`, `TAN SRI`, `DR`, …) are
    dropped;
  - common abbreviations are expanded: `MOHD`/`MOHAMAD`/… to `MUHAMMAD`, `ABD`
    to `ABDUL`, `SDN. BHD.`/`S/B`/`SENDIRIAN BERHAD` to `SDN BHD`;
  - the same words in a different order match (`AH KOW TAN` and `TAN AH KOW`);
  - a bank name of 20 characters or more that is a prefix of the expected name
    matches, because banks truncate long names. A shorter prefix doesn't: it's
    more likely a different, shorter name.
- **A mismatch isn't payable.** `settle_bank_account_verification` stores the
  bank's name in `bank_holder_name` and moves a verified account whose name
  didn't match to `name_mismatch`. Every payout and prize check already requires
  `status = 'verified'`. A verified response with no name also counts as a
  mismatch. `p_name_matched` defaults to false, so a caller that doesn't say the
  name matched never makes an account payable.
- **An admin decides each mismatch** on `/admin/bank-accounts`, through
  `review_bank_account_name`: confirm (with a note) or reject (the note is the
  reason emailed to the owner). The reviewer, time and note stay on the row.
  Owners aren't emailed when an account goes into review, only when it's
  decided.
- Accounts verified before this keep their status. Their bank name shows as
  "not recorded".

## Consequences

- The matcher leans towards matching. Every rule above treats both names the
  same way, so it can only lose detail, never add it. A name it wrongly
  accepts still had to match on every word that survived normalisation.
- A name it wrongly rejects costs an admin review, not a lost payout. Tune the
  rules in `holder-name.ts` and its tests when admins keep confirming the same
  pattern.
- Micro-deposit confirmation wasn't chosen: it costs a transfer per account and
  adds friction. Revisit it if name matching proves unreliable.
