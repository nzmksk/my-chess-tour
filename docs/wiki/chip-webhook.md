# CHIP webhooks

Two routes receive CHIP webhooks, one per CHIP product:

| Route                             | Product                     | Carries                                                                                               | Key                                                                   | Bad signature       |
| --------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------- |
| `POST /api/v1/webhooks/chip`      | CHIP **Collect** (money in) | Registration payments, sponsor prize-pool payments, refunds                                           | `CHIP_WEBHOOK_PUBLIC_KEY`, RSA over SHA-256                           | 401                 |
| `POST /api/v1/webhooks/chip/send` | CHIP **Send** (money out)   | Bank account verification, budget allocations, send instructions (organizer payouts and prize awards) | `CHIP_SEND_WEBHOOK_PUBLIC_KEY`, RSA over SHA-512, one key per webhook | 200 (acked, logged) |

Most of this page covers the Collect webhook. The Send webhook has its own section at the end: [CHIP Send webhook](#chip-send-webhook).

## Signature verification & key formatting

Webhook deliveries are signed with the **webhook's own Public Key** (CHIP Merchant Portal → Developers → Webhooks), set as `CHIP_WEBHOOK_PUBLIC_KEY`.
This is **not** the company key from `GET /public_key/`, which signs `success_callback` payloads only.
The signature is a base64 RSA PKCS#1 v1.5 signature over the SHA256 digest of the raw request body, in the `X-Signature` header.

Key formatting gotcha: in a `.env` file the PEM may be a double-quoted single line using `\n` — dotenv strips the quotes and expands `\n`.
But host env UIs (e.g. **Netlify**) store the value **verbatim**: copy that quoted/escaped form in and the surrounding quotes break PEM parsing, so every delivery fails signature verification (HTTP 401).
On those platforms paste the **raw multi-line PEM with no surrounding quotes**. `verifySignature` in `src/app/api/v1/webhooks/chip/route.ts` also defensively trims quotes and expands literal `\n`, and logs the failure reason (missing header / no key / parse error / mismatch) so misconfiguration is visible in logs.

## Delivery and retries

A delivery counts as delivered only when we answer 2xx. CHIP makes up to 8 attempts, the nth at 3^(n − 1) − 1 minutes after the first, so the last comes 36 hours 26 minutes after the first. Nothing is sent after that, so `GET /purchases/{id}/` is the source of truth for a purchase whose callbacks were lost.

Delivery is at least once, so every settlement path is idempotent. Delivery is also ordered per purchase: CHIP holds back a purchase's later events until the earlier ones are delivered. That's why events we don't act on are acknowledged, not refused. See CHIP's [delivery protocol](https://docs.chip-in.asia/chip-collect/overview/delivery-protocol).

## Event types

The registration settlement path consumes `purchase.paid` / `purchase.captured` / `purchase.payment_failure` (see [payment-flow.md](./payment-flow.md)); the refund path consumes `payment.refunded` / `purchase.refund_failure` / `purchase.pending_refund` (see [refund-flow.md](./refund-flow.md)). A purchase that is a sponsor's prize-pool contribution (a `prize_fundings` row, matched by purchase id then reference) is routed out ahead of registration settlement and settled by `settle_prize_funding` (see [prize-flow.md](./prize-flow.md)).

Available event types and when they are emitted:

`purchase.created`: Emitted when a Purchase is created. This happens as a result of POST `/purchases/` request executed successfully. Purchase.status will be == `created` in the received payload.

`purchase.paid`: Emitted when a Purchase is paid for. Purchase.status will be == `paid`. Happens when a payform is submitted (for a Purchase having `skip_capture == false`) and a successful payment is done by the payer or in case of /capture/ or /charge/ API requests executed successfully.

`purchase.payment_failure`: Emitted when payer submits a payment using the payform, but it doesn't complete successfully (e.g. because payer's account balance is insufficient). Purchase.status will be == `error`.

`purchase.refund_failure`: Emitted when a pending refund fails.

`purchase.capture_failure`: Emitted when a pending capture fails. The Purchase status is expected to be 'hold' after that.

`purchase.release_failure`: Emitted when a pending release fails. The Purchase status is expected to be 'hold' after that.

`purchase.pending_execute`: Emitted when transaction execution takes longer than expected on the acquirer side. See `pending_execute` Purchase status. When transaction becomes finalized, a `purchase.paid`, `purchase.hold` or `purchase.payment_failed` callback will be emitted.

`purchase.pending_charge`: Emitted when transaction execution takes longer than expected on the acquirer side. See `pending_charge` Purchase status. When transaction becomes finalized, a `purchase.paid` or `purchase.payment_failed` callback will be emitted.

`purchase.cancelled`: Emitted once POST `/purchases/{id}/cancel/` request succeeds. It won't be possible to pay for the related Purchase after that. Purchase.status will be == `cancelled`.

`purchase.hold`: Emitted when a Purchase having `skip_capture == true` has its payform submitted and "payment" performed successfully. The specified amount of funds will be placed on hold. Purchase.status will be == `hold`.

`purchase.captured`: Emitted when the POST `/purchases/{id}/capture/` request for a Purchase that previously had the status of hold succeeds. Purchase.status will be == `paid`.

`purchase.pending_capture`: Emitted when transaction execution takes longer than expected on the acquirer side. See `pending_capture` Purchase status. When transaction becomes finalized, a `purchase.captured` callback will be emitted.

`purchase.released`: Emitted when the POST `/purchases/{id}/release/` request for a Purchase that previously had the status of `hold` succeeds. Funds reserved will be released with no payment performed. Purchase.status will be == `released`.

`purchase.pending_release`: Emitted when transaction execution takes longer than expected on the acquirer side. See `pending_release` Purchase status. When transaction becomes finalized, a `purchase.released` callback will be emitted.

`purchase.preauthorized`: Emitted when preauthorization scenario (see description for the Purchase.skip_capture field) is executed successfully. Purchase will have a status of `preauthorized`.

`purchase.recurring_token_deleted`: Emitted when the POST `/purchases/{id}/delete_recurring_token/` request is executed successfully, deleting the recurring token associated with a Purchase. Purchase status will be the same as it were prior to this event.

`purchase.pending_recurring_token_delete`: Emitted when token deletion takes longer than expected on the acquirer side. When operation is finalized, a `purchase.recurring_token_deleted` callback will be emitted.

`purchase.pending_refund`: Emitted when refund transaction execution takes longer than expected on the acquirer side. See `pending_refund` Purchase status. When refund becomes finalized, a `payment.refunded` callback will ne emitted.

`payment.refunded`: Emitted when a Purchase is refunded (as a result of POST `/purchases/{id}/capture/` request done successfully or action performed in company's frontoffice system). The returned data will be a Payment object generated as a result of this action. A link to the original Purchase (that will have a status of `refunded`) will be present in the `related_to` field of this Payment.

`payout.pending`: Emitted when Payout execution has been initiated and is currently processing.

`payout.failed`: Emitted when a Payout processing was completed with an error. Payout.status will be == `error`. Note that payouts can spend up to 3-5 days (depending on the payout provider) in processing after being initiated.

`payout.success`: Emitted when a Payout is successfully processed. Payout.status will be == `success`. Note that payouts can spend up to 3-5 days (depending on the payout provider) in processing after being initiated.

`payment.charged_back`: Emitted when a Payment is `charged_back`.

`purchase.viewed`: Emitted when a Purchase is viewed.

`purchase.settled`: Emitted when a Purchase is settled.

`payout.created`: Emitted when a Payout is created.

`payment.chargeback_reversed`: Emitted when a Payment chargeback is reversed.

Available options: `purchase.created`, `purchase.paid`, `purchase.payment_failure`, `purchase.refund_failure`, `purchase.capture_failure`, `purchase.release_failure`, `purchase.pending_execute`, `purchase.pending_charge`, `purchase.cancelled`, `purchase.hold`, `purchase.captured`, `purchase.pending_capture`, `purchase.released`, `purchase.pending_release`, `purchase.preauthorized`, `purchase.pending_recurring_token_delete`, `purchase.recurring_token_deleted`, `purchase.pending_refund`, `payment.refunded`, `payout.pending`, `payout.failed`, `payout.success`, `payment.charged_back`, `purchase.viewed`, `purchase.settled`, `payout.created`, `payment.chargeback_reversed`

## CHIP Send webhook

`POST /api/v1/webhooks/chip/send` (`src/app/api/v1/webhooks/chip/send/route.ts`) is a separate route from Collect's, because the two products sign differently and send different things. CHIP's references are [Event Types and Payloads](https://docs.chip-in.asia/chip-send/api-reference/webhooks/events), [Validating Webhooks](https://docs.chip-in.asia/chip-send/api-reference/webhooks/validation) and [Delivery Protocol](https://docs.chip-in.asia/chip-send/api-reference/webhooks/delivery-protocol).

### Signature

`X-Signature` is a base64 RSA PKCS#1 v1.5 signature over the **SHA-512** digest of the raw body (Collect uses SHA-256). Every Send webhook has its own key pair. The public half is that webhook's `public_key` (`GET /api/webhooks/{id}`), set as `CHIP_SEND_WEBHOOK_PUBLIC_KEY`. There is no account-wide key, and deleting and recreating the webhook issues a new key, so the variable has to change with it. The key formatting rules above apply here too (`normalizePublicKey`).

The route test verifies CHIP's published fixture: its key, its signature and the 387-byte body. A change that breaks verification fails there, not in production.

### Responses

| Situation                                           | Response                   | Why                                                                                                                                                                                         |
| --------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bad or missing signature                            | 200, logged, not processed | CHIP retries any non-2xx, 25 times over about three weeks, and a forged or misrouted delivery won't become valid on a retry. This differs from Collect's 401 on purpose, so don't "fix" it. |
| `CHIP_SEND_WEBHOOK_PUBLIC_KEY` missing or not a PEM | 500                        | It's our misconfiguration: CHIP keeps retrying until the key is fixed, instead of the events being dropped.                                                                                 |
| A signed body that isn't JSON                       | 200, logged                | A redelivery can't fix it.                                                                                                                                                                  |
| A database lookup or settle fails                   | 500                        | CHIP redelivers. The money may already have moved, so the failure must not be swallowed.                                                                                                    |
| The row vanished before settling (`P0002`)          | 200                        | There's nothing left to retry for.                                                                                                                                                          |

### Events

CHIP names the event in the `Event-Type` header. The body is the bare resource as it is after the change, sent as compact JSON.

| `Event-Type`               | Handling                                                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bank_account_status`      | `verified` and `rejected` settle the account through `settle_bank_account_verification`, with CHIP's `rejection_reason`. `received`, `pending` and `reviewing` are acknowledged and nothing changes.                                           |
| `send_instruction_status`  | `completed` settles the transfer as paid. `rejected` and the legacy `deleted` settle it as failed, with `failure_reason` `send_instruction_<state>`. Every other state is acknowledged. `accepted` isn't success: it can still end `rejected`. |
| `budget_allocation_status` | Acknowledged and ignored. A payout parked on budget re-checks its allocation on its next run ([payout-flow.md](./payout-flow.md#the-daily-run)).                                                                                               |

The body's `status` or `state` decides the outcome, not the event name. `chipBankAccountOutcome` and `chipSendOutcome` read nothing else, and any state they don't recognise counts as pending. When there's no `Event-Type` header, the route goes by the body's shape: a bank account has `account_number` and `bank_code` at the top level, and an instruction has a `state`.

Each instruction delivery is logged with its state, CHIP id, reference, outcome and `rejection_reason`. Long digit runs in the reason are redacted with `redactDigits`. The log never includes the amount, email or account details.

### Matching a delivery to our rows

- **Bank accounts:** first by `reference` (our row id) in `organization_bank_accounts` and then `player_bank_accounts`, and only after that by CHIP's `id` in each table. Both tables are searched by reference before either is searched by id, because an organization and a player can register the same real account, and CHIP may give both registrations the same id. For the same reason, a match by CHIP id takes the newest row.
- **Send instructions:** `payouts` by `reference` (the payout id), then by `chip_send_instruction_id`. If neither matches, `prize_awards` is searched the same way (#523).
- A verdict on a player's account runs `onPlayerBankVerdict` after the response, so CHIP never waits on our own send.
- A delivery that matches nothing is acknowledged and logged.

### Delivery

A failed delivery is retried up to 25 times over about 21 days, then CHIP emails the webhook's address. CHIP can skip intermediate states, and a retry can arrive after a newer delivery. Settlement therefore keeps the first terminal verdict, and the daily run reconciles anything a lost delivery left stuck ([payout-flow.md](./payout-flow.md#the-daily-run)).
