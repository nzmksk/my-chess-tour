# Architecture Decision Records

Each file here records one decision about the code that isn't obvious from
the code: what was decided, why, and what it costs. They replace the
explanatory code comments that [ADR 0001](0001-no-code-comments.md) bans.

Flows that span many files (payments, refunds, payouts, authentication,
releases) are written up in [`wiki/`](../../wiki). A decision already recorded
there isn't repeated here.

## Writing one

1. Copy [`template.md`](template.md) to `NNNN-short-title.md`, numbered after
   the last record below.
2. Keep it to one decision. Name the files and identifiers it governs so a
   reader can grep from the record to the code.
3. Add it to the index below.

A record isn't edited when the decision changes. Write a new one, mark the
old one `Superseded by NNNN`, and link both ways.

## Index

| #    | Decision                                                                                         | Status   |
| ---- | ------------------------------------------------------------------------------------------------ | -------- |
| 0001 | [No code comments](0001-no-code-comments.md)                                                     | Accepted |
| 0002 | [`src/lib` is the bottom layer](0002-src-lib-is-the-bottom-layer.md)                             | Accepted |
| 0003 | [No database error text in responses](0003-no-database-error-text-in-responses.md)               | Accepted |
| 0004 | [Spreadsheet exports are hand-written CSV and XLSX](0004-spreadsheet-exports.md)                 | Accepted |
| 0005 | [Browser API origin policy](0005-browser-api-origin-policy.md)                                   | Accepted |
| 0006 | [Rate limits key on the platform's client IP](0006-rate-limits-key-on-the-platform-client-ip.md) | Accepted |
| 0007 | [Server components call their own build's API](0007-server-components-call-their-own-build.md)   | Accepted |
| 0008 | [Side effects run after the response](0008-side-effects-run-after-the-response.md)               | Accepted |
| 0009 | [Refund states and stuck refunds](0009-refund-states.md)                                         | Accepted |
| 0010 | [Legal versions are dated histories](0010-legal-versions-are-dated-histories.md)                 | Accepted |
| 0011 | [Payout banks mirror CHIP Send's list](0011-payout-banks-mirror-chip-send.md)                    | Accepted |
