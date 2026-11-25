# Architecture Decision Records

Each file here records one decision about the code that isn't obvious from
the code: what was decided, why, and what it costs. They replace the
explanatory code comments that [ADR 0001](0001-no-code-comments.md) bans.

Flows that span many files (payments, refunds, payouts, authentication,
releases) are written up in [`docs/wiki/`](../wiki). A decision already recorded
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

| #    | Decision                                                                                               | Status   |
| ---- | ------------------------------------------------------------------------------------------------------ | -------- |
| 0001 | [No code comments](0001-no-code-comments.md)                                                           | Accepted |
| 0002 | [`src/lib` is the bottom layer](0002-src-lib-is-the-bottom-layer.md)                                   | Accepted |
| 0003 | [No database error text in responses](0003-no-database-error-text-in-responses.md)                     | Accepted |
| 0004 | [Spreadsheet exports are hand-written CSV and XLSX](0004-spreadsheet-exports.md)                       | Accepted |
| 0005 | [Browser API origin policy](0005-browser-api-origin-policy.md)                                         | Accepted |
| 0006 | [Rate limiting](0006-rate-limiting.md)                                                                 | Accepted |
| 0007 | [Server components call their own build's API](0007-server-components-call-their-own-build.md)         | Accepted |
| 0008 | [Side effects run after the response](0008-side-effects-run-after-the-response.md)                     | Accepted |
| 0009 | [Refund states and stuck refunds](0009-refund-states.md)                                               | Accepted |
| 0010 | [Legal versions are dated histories](0010-legal-versions-are-dated-histories.md)                       | Accepted |
| 0011 | [Payout banks mirror CHIP Send's list](0011-payout-banks-mirror-chip-send.md)                          | Accepted |
| 0012 | [Tournament dates belong to the venue](0012-tournament-dates-belong-to-the-venue.md)                   | Accepted |
| 0013 | [Tournament pages are cached and purged by tag](0013-tournament-page-caching.md)                       | Accepted |
| 0014 | [What a prize declaration must hold](0014-prize-declarations.md)                                       | Accepted |
| 0015 | [Global test doubles](0015-global-test-doubles.md)                                                     | Accepted |
| 0016 | [Pages opt out of site chrome](0016-pages-opt-out-of-site-chrome.md)                                   | Accepted |
| 0017 | [Notification emails](0017-notification-emails.md)                                                     | Accepted |
| 0018 | [Bug reports are written for a public repo](0018-bug-reports-are-written-for-a-public-repo.md)         | Accepted |
| 0019 | [FIDE ratings are scraped from profile pages](0019-fide-ratings-are-scraped.md)                        | Accepted |
| 0020 | [Invitation tokens are stored hashed](0020-invitation-tokens-are-stored-hashed.md)                     | Accepted |
| 0021 | [The roster shows only what organizers may see](0021-roster-shows-only-what-organizers-may-see.md)     | Accepted |
| 0022 | [Session identity and audit scope on the server](0022-session-identity-and-audit-scope.md)             | Accepted |
| 0023 | [Uploads are verified before their path is recorded](0023-uploads-are-verified-before-registration.md) | Accepted |
| 0024 | [Text sent to and received from CHIP Send](0024-text-to-and-from-chip-send.md)                         | Accepted |
| 0025 | [The CHIP Collect and CHIP Send clients](0025-chip-clients.md)                                         | Accepted |
| 0026 | [Payout accounts are matched by holder name](0026-payout-accounts-are-matched-by-holder-name.md)       | Accepted |
| 0027 | [One account per mailbox](0027-one-account-per-mailbox.md)                                             | Accepted |
| 0028 | [A FIDE ID must carry the player's name](0028-a-fide-id-must-carry-the-players-name.md)                | Accepted |
