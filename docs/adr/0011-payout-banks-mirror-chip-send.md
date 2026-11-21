# 0011. Payout banks mirror CHIP Send's list

- Status: Accepted
- Date: 2026-11-21
- Issue: #519, #675

## Context

Organizers and players nominate a bank to be paid into, and CHIP Send's
`bank_code` field takes a SWIFT/BIC. The two possible errors aren't equal: a
code we accept that CHIP rejects is a failed payout, found after a tournament
with someone waiting on money; a code CHIP accepts that we omit is a bank
missing from a dropdown.

## Decision

`MALAYSIAN_BANKS` (`src/lib/reference/malaysian-banks.ts`) is a 1:1 mirror of
the `BankCode` schema in CHIP Send's OpenAPI document
(<https://docs.chip-in.asia/openapi/chip-send.yaml>), last reconciled on
2026-11-21: same 37 codes, no more and no fewer. We don't curate it, because
every judgement about which banks are "plausible" trades the cheap error for
the expensive one. So corporate and custody banks stay, as do Finexus Cards
and Touch 'n Go eWallet, which are e-money issuers labelled "bank" in the UI.
If the schema's description ("the complete set of codes accepted by POST
/send/bank_accounts") and its `enum` disagree, the description wins; the
`enum` has lagged behind before (#519).

CHIP details not to "fix": MBSB Bank is `AFBQMYKL`, the legacy Asian Finance
Bank code CHIP still uses, not `MBSBMYKL`. Citibank (`CITIMYKL`) was dropped
in the 2026-08-16 reconciliation and restored when CHIP added it back.

The client submits only the SWIFT code. The server takes the display name
from this table (`bankNameForSwift`) before writing `bank_name`, so a row can
never say "Maybank" while the money goes to CIMB, and an unknown code is a
validation failure, never stored as-is.

`malaysian-banks.test.ts` pins the exact set as a literal copied from CHIP's
schema rather than derived from the list, so changing the list without
checking CHIP first fails there instead of at payout time. It also checks
codes against `chk_bank_code_format` and names against
`bank_name varchar(100)`.

## Account number lengths

CHIP Send checks an account number's length against its bank when the account
is registered. A wrong length is refused then, which happens after the form
was saved, with the organizer or winner gone and a payout waiting. So each
entry also carries `accountDigits`, the range from CHIP's
[supported banks](https://docs.chip-in.asia/chip-send/api-reference/bank-accounts/supported-banks)
table. `accountNumberLengthError` checks it in `validateBankAccount` on the
client, and in the organization bank account and organizer application
validators on the server (`PATCH /api/v1/profile/banking` uses the former). The
message names the bank and the expected digits. The database keeps the
looser 5 to 20 digits (`chk_bank_account_number_digits`), so a correction
from CHIP is a code change, not a migration. A number of the right length
can still fail CHIP's verification with the bank.

## Bank details forms

`BankAccountFields` (`src/components/BankAccountFields.tsx`) is the one set
of bank, holder and account-number fields, used by the organizer application,
the organization settings and the player settings card, so every bank account
is collected and validated the same way. Players choose from the same list,
because a platform-distributed prize is sent to their account through CHIP
Send (#523). Account numbers are stored as digits only; people copy them off
a statement with spaces and dashes, so the same rule strips them on the client
and in `PATCH /api/v1/profile/banking`. The component is presentation-only and
owns no submit, because each caller sends the fields to a different endpoint,
one of them inside a much larger POST. A stored account number is never sent
back to the browser in full: the forms show its last four digits and ask for
the whole number again on every change.

## Consequences

- Adding or removing a bank starts with CHIP's schema, then both the list and
  the test. So does a change to a bank's account number length, which starts
  from CHIP's supported banks table.
- Bank accounts saved before the length check can still have the wrong
  length. CHIP refuses them at registration, as before.
