## Signature verification & key formatting

Webhook deliveries are signed with the **webhook's own Public Key** (CHIP Merchant Portal → Developers → Webhooks), set as `CHIP_WEBHOOK_PUBLIC_KEY`.
This is **not** the company key from `GET /public_key/`, which signs `success_callback` payloads only.
The signature is a base64 RSA PKCS#1 v1.5 signature over the SHA256 digest of the raw request body, in the `X-Signature` header.

Key formatting gotcha: in a `.env` file the PEM may be a double-quoted single line using `\n` — dotenv strips the quotes and expands `\n`.
But host env UIs (e.g. **Netlify**) store the value **verbatim**: copy that quoted/escaped form in and the surrounding quotes break PEM parsing, so every delivery fails signature verification (HTTP 401).
On those platforms paste the **raw multi-line PEM with no surrounding quotes**. `verifySignature` in `src/app/api/v1/webhooks/chip/route.ts` also defensively trims quotes and expands literal `\n`, and logs the failure reason (missing header / no key / parse error / mismatch) so misconfiguration is visible in logs.

## Event types

The registration settlement path consumes `purchase.paid` / `purchase.captured` / `purchase.payment_failure` (see [payment-flow.md](./payment-flow.md)); the refund path consumes `payment.refunded` / `purchase.refund_failure` / `purchase.pending_refund` (see [refund-flow.md](./refund-flow.md)).

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
