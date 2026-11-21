# 0010. Legal versions are dated histories

- Status: Accepted
- Date: 2026-11-21
- Issue: #451, #675

## Context

Acceptance of the Terms used to be a checkbox and nothing else: the signup
form validated it and threw it away, so there was no record that anyone had
agreed to anything, nor of which wording. That's tolerable for a free signup,
not for an Organizer Agreement that governs money movement and makes a
claw-back enforceable. The effective date was also a literal in four files,
free to drift from what was recorded.

## Decision

`src/lib/reference/legal.ts` is the one place that says which version of
each document is current.

- **Versions are ISO dates** (`2026-08-02`), not semver: a legal document has
  an effective date, and "which wording did they agree to?" is answered by a
  date. They're stored in `varchar(20)` columns (`users.terms_version`,
  `organizations.agreement_version`, each consent grant). ISO keeps string
  comparison and chronological order in agreement, which `changesSince`
  relies on.
- **Each document is a history, newest first**, and the current version
  (`TERMS_VERSION`, `ORGANIZER_AGREEMENT_VERSION`) is derived from entry 0.
  "What changed?" is about the gap between the version someone accepted and
  the current one, so `changesSince(accepted)` returns the changes of every
  version published since, nothing when they're current, and the whole history
  for `null` or a version that predates the list. `AgreementGate` presents the
  last case as what the agreement covers, not as what changed. The first entry
  of a document summarises what it says; every later entry is a delta against
  the one before, written for the person reading it rather than as a commit
  log. The Privacy Policy is versioned with the Terms.
- **Every page renders its effective date from the same constant** that's
  written to the database, so the document shown and the version recorded
  can't drift. `formatLegalVersion` turns `2026-08-02` into `2 August 2026`
  without `Intl.DateTimeFormat`: these are calendar dates, and parsing one into
  a `Date` would read it in the server's zone and can shift the day. A
  malformed constant renders as-is rather than crashing a page users are
  required to read.
- **Bumping a constant is the re-acceptance mechanism.** An organization on an
  older `agreement_version` sees a blocking panel, and the money functions
  refuse to move money until it accepts. The SQL side can't import this
  module, so `current_organizer_agreement_version()` must be bumped with
  `ORGANIZER_AGREEMENT_VERSION`, by a new migration that replaces the function
  (the last definition in filename order is in force). If they drift, every
  payout is refused, or stale organizations get paid. `legal.test.ts` fails
  when they differ.
- **Sensitive data consent statements follow the same rule** (#451). Health
  data (an OKU card) and financial data (a player's bank details) are each
  held only with their own explicit consent, asked for with its own checkbox
  when the data is collected and recorded in `sensitive_data_consents`.
  Agreeing to the Terms isn't consent to either. The statement is the checkbox
  label word for word, and states that consent can be withdrawn, so the user
  learns it before agreeing. A reworded statement is a new entry at the top,
  so the wording behind every recorded version stays in the code.
  `SensitiveDataConsent` renders it as its own checkbox, never pre-ticked
  and never folded into another one: bundled or default-on consent isn't
  the explicit consent the PDPA asks for. The grant is recorded before the
  data is sent, and a failure stops the submission, because the database
  refuses an OKU upload or a bank-details save without it.
  `grantSensitiveDataConsent` (`src/services/consent/sensitive-data.ts`)
  takes the version from `legal.ts` on the server, never from the request:
  what matters is which statement the server showed, and a version the client
  sends proves nothing. A withdrawal is recorded only after the data is
  deleted, since a withdrawal recorded while the data still exists would be a
  false record; if recording fails, the data is already gone and the user can
  withdraw again.

## Consequences

- Updating a document means adding a history entry, plus a migration for the
  Organizer Agreement, and keeping the page, the modal and `legal.ts` in step.
- The recorded version always names wording that can still be read.
