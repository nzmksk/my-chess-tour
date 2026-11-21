# 0024. Text sent to and received from CHIP Send

- Status: Accepted
- Date: 2026-11-21
- Issue: #519, #675

## Context

[payout-flow](../wiki/payout-flow.md) records how payouts and prize awards
move money and which CHIP answers are retried. Two kinds of text cross the
boundary with CHIP Send, and neither can be trusted as-is: free text we send
it, and error bodies it sends back.

## Decision

- **Descriptions are sanitised.** A transfer's description includes the
  tournament name, which is free text, and CHIP rejects most punctuation
  with a 422. Every description goes through `toChipSendDescription`
  (`src/services/chip/send.ts`).
- **Long digit runs are redacted from CHIP's answers.** CHIP error bodies can
  echo the submitted account number. `redactDigits`
  (`src/services/payouts/send-errors.ts`) replaces any run of six or more
  digits before an error reaches the logs or `payouts.failure_reason`, which
  organizers and admins read. `describeSendError` and the bank-account
  registration logs both use it.
- **`failure_reason` is never shown raw.** It holds our own code for failures
  we decide and CHIP's status and message for the ones CHIP decides. Neither is
  fit for an organizer, so everything they see goes through
  `describePayoutFailure` (`src/services/payouts/failure-reason.ts`); admins
  also see the stored value.
- The same classification (`isRetryableStatus`, `isRefusedBeforeSending`) is
  shared by organizer payouts and prize awards, so both retry, release and fail
  on exactly the same answers.

## Consequences

- A new path that sends a CHIP Send instruction or logs a CHIP error reuses
  these helpers rather than formatting text itself.
