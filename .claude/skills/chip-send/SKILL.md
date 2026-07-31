---
name: chip-send
description: Use this skill whenever the user wants to integrate the CHIP Send (chip-in.asia) payouts API into their application. Trigger this skill for tasks involving listing accounts, registering recipient bank accounts, requesting budget allocations, creating send instructions, configuring webhooks, or troubleshooting the three-header auth scheme (Authorization + epoch + HMAC-SHA512 checksum). This skill covers backend API integration in a language-agnostic way.
---

# CHIP Send — Backend Integration Skill

CHIP Send (chip-in.asia) is the payouts arm of the CHIP platform: it lets
a registered merchant send MYR funds to recipient bank accounts
programmatically, with a four-step flow (check balance → allocate budget
→ register recipient → send).

> **Always integrate from the server side.** CHIP Send, like CHIP Collect,
> does not enable CORS. Never expose your API Secret to the
> browser/client — the secret is used to compute per-request checksums
> and must stay on your server.

---

## 📐 API Schema — Fetch, Don't Remember

The authoritative source of truth for every endpoint is the CHIP Send
OpenAPI spec:

- **OpenAPI YAML:** https://docs.chip-in.asia/openapi/chip-send.yaml
- **Rendered reference:** https://docs.chip-in.asia/chip-send/api-reference/introduction

**Do not hardcode endpoint paths in your integration code.** When you
need an endpoint:

1. Fetch the spec (or the rendered reference) and copy the path
   verbatim.
2. If a path you "remember" isn't in the spec, the spec wins —
   your memory is wrong.
3. If you build a client library, generate it from the spec rather
   than writing paths by hand.

The endpoints referenced in this file (Accounts, Send Limits, Bank
Accounts, Send Instructions) are kept here as **worked examples**,
not as the canonical list. Always cross-check the spec.

---

## Quick Reference

| Item | Value |
|---|---|
| Base URL (sandbox) | `https://staging-api.chip-in.asia/api` |
| Base URL (production) | `https://api.chip-in.asia/api` |
| Auth header 1 | `Authorization: Bearer <API Key>` |
| Auth header 2 | `epoch: <unix seconds, must be within 30s of server>` |
| Auth header 3 | `checksum: HEX( HMAC_SHA512( api_secret, "<epoch><api_key>" ) )` |
| Content-Type | `application/json` |
| OpenAPI spec | https://docs.chip-in.asia/openapi/chip-send.yaml |
| Docs | https://docs.chip-in.asia/chip-send/api-reference/introduction |
| Portal | https://portal.chip-in.asia/control/settings/applications |

---

## Prerequisites

Unlike CHIP Collect (self-serve in the portal), CHIP Send requires
**admin setup** before any integration can begin. The merchant's CHIP
Account Manager must be contacted with:

1. A **primary email address** for the Send account.
2. The **email addresses of every required approver**. If two
   approvals are required for budget allocations, both email
   addresses must be provided.

Two credentials are issued to the merchant:

| Credential | Where it goes | What it does |
|---|---|---|
| **API Key** | `Authorization: Bearer <API Key>` header | Identifies the merchant. Sent on every request. |
| **API Secret** | Never sent over the network. Used only for signing. | Computes the per-request checksum. Must be stored securely, like a password. |

The API Key and the `api_key` value used inside the checksum string
are the **same value**. The API Secret is **never** transmitted — it
only lives on the merchant's server.

Both credentials are available in the merchant portal at
[CHIP Control → Settings → Applications](https://portal.chip-in.asia/control/settings/applications).

---

## How Authentication Works

Every request must include three headers. Skipping any one of them
returns `401 Unauthorized`.

| Header | Value |
|---|---|
| `Authorization` | `Bearer <API Key>` |
| `epoch` | Current Unix timestamp in seconds (e.g. `1689826456`) |
| `checksum` | Hex-encoded HMAC-SHA512 of the signing string, computed with the API Secret |

**Clock skew:** the `epoch` value must be within **30 seconds** of
the server's clock. If it's too old or too far in the future, the
request is rejected as `Unauthorized`. The merchant's server clock
must be synchronised (NTP, chrony, or your cloud provider's time
service).

### How to compute the checksum

The signing string is formed by **concatenating the `epoch` value
and the API Key with no separator, in that order**:

```
signing_string = <epoch> + <API Key>
```

For example, with `epoch = 1689826456` and
`API Key = e0645c9e-fcf2-4f29-a327-202f7ed3d969`:

```
1689826456e0645c9e-fcf2-4f29-a327-202f7ed3d969
```

The checksum is then:

```
checksum = HEX( HMAC_SHA512( key = API Secret, message = signing_string ) )
```

The expected value for the example above is:

```
45bee62dba8087ab1e7e767d92f8d6e26f8bd19ee5fd2fef6386bb9425976498a86ffdbddb7a49919998e993c20626196ea652320f438a9528d2b8c9d19ec266
```

Use this as a unit-test fixture to verify your implementation before
sending any real request.

### Language examples

**Node.js**:
```js
const crypto = require('crypto');

const epoch = Math.floor(Date.now() / 1000).toString();
const apiKey = process.env.CHIP_API_KEY;
const apiSecret = process.env.CHIP_API_SECRET;

const signingString = epoch + apiKey;
const checksum = crypto
  .createHmac('sha512', apiSecret)
  .update(signingString)
  .digest('hex');

// Then send the request with headers:
//   Authorization: Bearer <apiKey>
//   epoch: <epoch>
//   checksum: <checksum>
```

**Python**:
```python
import hashlib, hmac, time

epoch = str(int(time.time()))
api_key = os.getenv("CHIP_API_KEY")
api_secret = os.getenv("CHIP_API_SECRET")

signing_string = (epoch + api_key).encode()
checksum = hmac.new(api_secret.encode(), signing_string, hashlib.sha512).hexdigest()

# Then send the request with headers:
#   Authorization: Bearer <api_key>
#   epoch: <epoch>
#   checksum: <checksum>
```

**PHP**:
```php
<?php
$epoch = (string) time();
$apiKey = getenv('CHIP_API_KEY');
$apiSecret = getenv('CHIP_API_SECRET');

$signingString = $epoch . $apiKey;
$checksum = hash_hmac('sha512', $signingString, $apiSecret);

// Then send the request with headers:
//   Authorization: Bearer <apiKey>
//   epoch: <epoch>
//   checksum: <checksum>
```

> ⚠️ **The checksum must be recomputed for every request with a
> fresh `epoch`.** A common integration bug is computing the
> checksum once and reusing it across requests — the server will
> reject these as `Unauthorized`.

---

## Step 1 — Generate `.env` and a Test Script

Generate these two files in the project root:

`.env` (must never be committed):
```
# .env
# CHIP Send API credentials
# Get these from https://portal.chip-in.asia/control → Settings → Applications
# ⚠️ Never commit this file. Make sure .env is in your .gitignore.

CHIP_API_KEY=
CHIP_API_SECRET=
```

`.env.example` (safe to commit):
```
# .env.example
# Copy to .env and fill in your credentials from https://portal.chip-in.asia
CHIP_API_KEY=your_api_key_here
CHIP_API_SECRET=your_api_secret_here
```

**Generate a smoke-test script.** This verifies your three-header
auth works end-to-end before wiring up the full payout flow.

**Node.js** — save as `test-chip-send.js`:
```js
require('dotenv').config();
const https = require('https');
const crypto = require('crypto');

const apiKey = process.env.CHIP_API_KEY;
const apiSecret = process.env.CHIP_API_SECRET;
const epoch = Math.floor(Date.now() / 1000).toString();
const signingString = epoch + apiKey;
const checksum = crypto.createHmac('sha512', apiSecret).update(signingString).digest('hex');

const options = {
  hostname: 'staging-api.chip-in.asia',
  path: '/api/send/accounts',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'epoch': epoch,
    'checksum': checksum
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`\nHTTP ${res.statusCode}`);
    try {
      const json = JSON.parse(data);
      if (res.statusCode === 200) {
        console.log('✅ CHIP Send auth is working!');
        console.log(JSON.stringify(json, null, 2));
      } else {
        console.error('❌ Something went wrong:');
        console.error(JSON.stringify(json, null, 2));
      }
    } catch (e) {
      console.error('❌ Failed to parse response:', data);
    }
  });
});
req.on('error', e => console.error('❌ Request failed:', e.message));
req.end();
```

**Python** — save as `test_chip_send.py`:
```python
import os, json, hmac, hashlib, time, urllib.request
from dotenv import load_dotenv
load_dotenv()

api_key = os.getenv("CHIP_API_KEY")
api_secret = os.getenv("CHIP_API_SECRET")
epoch = str(int(time.time()))
signing_string = (epoch + api_key).encode()
checksum = hmac.new(api_secret.encode(), signing_string, hashlib.sha512).hexdigest()

req = urllib.request.Request(
    "https://staging-api.chip-in.asia/api/send/accounts",
    headers={
        "Authorization": f"Bearer {api_key}",
        "epoch": epoch,
        "checksum": checksum
    }
)
try:
    with urllib.request.urlopen(req) as res:
        data = json.loads(res.read())
        print("\n✅ CHIP Send auth is working!")
        print(json.dumps(data, indent=2))
except urllib.error.HTTPError as e:
    print(f"\n❌ HTTP {e.code}: {e.read().decode()}")
```

Run it: `node test-chip-send.js` or `python test_chip_send.py`. A
`200 OK` with an accounts payload confirms the three-header auth
works. **Delete the test script before deploying to production.**

---

## Step 2 — The Four-Step Payout Flow

A complete payout consists of four steps. **Steps 1-2 happen once per
payout batch; steps 3-4 happen once per recipient.**

### Step 2.1 — Check the convertible balance

```
GET /api/send/accounts
```

Returns one account per currency. The key fields are:

- `current_balance` — the available balance for send instructions.
- `convertible_balance_from_statement` — additional balance unlocked
  from settled funds (resets daily in sandbox; real-time in production).

**Why this matters:** every send instruction reduces `current_balance`.
A `403 Forbidden` on a create-send-instruction call usually means
insufficient balance.

### Step 2.2 — Increase the send limit (allocate budget)

```
POST /api/send/send_limits
Content-Type: application/json

{
  "amount": 5000
}
```

The `amount` is in **MYR × 100** (so `5000` = RM 50.00, mirroring
CHIP Collect's cents convention). This call allocates additional
budget from `convertible_balance_from_statement` into
`current_balance`.

**Approval flow:** if your account requires approval, the request
generates an email to each approver. Once all required approvers
click **Approve** in the email, the new balance is reflected in the
accounts response.

You can re-send the approval email with:

```
POST /api/send/send_limits/{id}/resend_approval_requests
```

### Step 2.3 — Register a recipient bank account

```
POST /api/send/bank_accounts
Content-Type: application/json

{
  "account_number": "157380112229",
  "bank_code": "MBBEMYKL",
  "name": "Ahmad Razali",
  "reference": "VENDOR-EMP-001"
}
```

- `account_number` — the recipient's bank account number (no dashes
  or spaces).
- `bank_code` — the SWIFT/BIC code of the recipient's bank
  (e.g. `MBBEMYKL` for Maybank Malaysia).
- `name` — the recipient's name as it appears on the account.
- `reference` — **unique** value used to prevent duplicate
  submissions. Reuse it across retries.

Successful response returns a `bank_account_id` (an integer) and a
status (`verified` or `unverified`). Use that ID in step 2.4.

### Step 2.4 — Create a send instruction

```
POST /api/send/send_instructions
Content-Type: application/json

{
  "bank_account_id": 1,
  "amount": "100",
  "description": "Vendor payout for invoice INV-2024-0892",
  "email": "recipient@example.com",
  "reference": "INV-2024-0892",
  "send_recipient_receipt": true
}
```

- `bank_account_id` — the ID returned by step 2.3.
- `amount` — **string** in MYR × 100 (so `"100"` = RM 1.00).
  Note this differs from Send Limit's numeric `amount`.
- `description` — 1–140 chars, shown in the recipient receipt.
- `reference` — your internal ID for the payout (1–40 chars).
- `email` — recipient's email; receives the receipt if
  `send_recipient_receipt` is `true`.
- `send_recipient_receipt` — boolean, default `false`.

A `200 OK` with `state: "completed"` confirms the payout cleared.
The `receipt_url` field is the public receipt the recipient sees.

> ⚠️ **`amount` is a string, not a number.** This is the most common
> integration bug for Send. JSON numbers lose precision for large
> values; strings don't. Always send `"100"`, never `100`.

---

## Step 3 — Idempotency and the `reference` Field

The `reference` field on bank accounts, send limits, and send
instructions exists specifically to **prevent duplicate
submissions**. Use a deterministic value (e.g. your internal
invoice ID) so a retried call after a network error doesn't
create a second recipient or send a second payout.

| Resource | `reference` field | Behavior on retry |
|---|---|---|
| Bank Account | Optional, max 65535 chars | A duplicate `reference` returns the existing record. |
| Send Instruction | Required, 1–40 chars | A duplicate `reference` returns the existing payout, no double-spend. |

---

## Step 4 — Webhooks (recommended for production)

Configure a webhook in
[CHIP Control → Settings → Applications](https://portal.chip-in.asia/control/settings/applications).
CHIP Send will POST to your callback URL for events like
`send_instruction.created`, `send_instruction.completed`,
`bank_account.verified`, etc.

> Use webhooks as the **source of truth** for state transitions.
> Polling `GET /send/send_instructions/{id}` works but is rate-limited
> and stale by design (the list endpoint is cached for an hour).

---

## Step 5 — Webhook Signature Verification

CHIP Send webhook payloads are signed. **The signature scheme is
the same as the API auth** — `HMAC-SHA512`, keyed on your
`api_secret`, encoded as **hex**. This is *different* from CHIP
Collect, which uses RSA-SHA512 with Base64 encoding. Don't reuse
Collect verification code on Send.

**Algorithm (matches the description in the [OpenAPI spec](https://docs.chip-in.asia/openapi/chip-send.yaml) and the [rendered reference](https://docs.chip-in.asia/chip-send/api-reference/introduction)):**

| Property | Value |
|---|---|
| Header | `X-Signature` |
| Algorithm | `HMAC-SHA512` |
| Encoding | **hex** (lowercase, 128 chars) |
| Key | Your `api_secret` (the same value used for API auth) |
| Signed payload | The **raw request body** as bytes (not the parsed JSON) |
| Library (Node.js) | `crypto.createHmac('sha512', api_secret).update(rawBody).digest('hex')` |
| Library (Python) | `hmac.new(api_secret.encode(), raw_body, hashlib.sha512).hexdigest()` |

**Verification logic (pseudocode):**

```
1. Read the raw request body as bytes — do NOT parse JSON first
2. Compute: expected = HEX( HMAC_SHA512( api_secret, body ) )
3. Compare expected to the X-Signature header in constant time
4. If they don't match -> return HTTP 200 but skip processing
   (returning 4xx causes CHIP to retry; you want silent rejection)
```

> ⚠️ **Clock skew tolerance is 120 seconds in the past, 60
> seconds in the future** on the inbound side (the merchant's
> request to CHIP, not the webhook delivery). Plan your NTP
> accordingly. The Send OpenAPI spec advertises 30 seconds; the
> actual tolerance is more generous. Either is safe — the
> difference matters only when debugging.

**Node.js example:**

```js
const crypto = require('crypto');

function verifySignature(rawBody, signatureHeader, apiSecret) {
  const expected = crypto
    .createHmac('sha512', apiSecret)
    .update(rawBody)  // rawBody must be a Buffer, not a parsed object
    .digest('hex');

  // Constant-time comparison to avoid timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signatureHeader, 'hex')
  );
}
```

**Python example:**

```python
import hmac, hashlib

def chip_send_signature_valid(raw_body: bytes, signature_header: str, api_secret: str) -> bool:
    expected = hmac.new(
        api_secret.encode(),
        raw_body,
        hashlib.sha512
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

> If your framework auto-parses the body (Express, FastAPI, etc.),
> you must capture the raw bytes **before** parsing. In Express,
> use `express.raw({ type: 'application/json' })` and call
> `JSON.parse(rawBody)` after verification. In FastAPI, read
> `await request.body()` before any Pydantic model parsing.

---

## Step 6 — Go Live Checklist

> 🧪 **Complete all sandbox testing before switching to live credentials.**

- [ ] `.env` created with sandbox API Key and Secret, added to `.gitignore`
- [ ] Test script returned `200 OK` from `/send/accounts`
- [ ] A full payout completed in sandbox (all four steps, ending
      in `state: "completed"`)
- [ ] Webhook signature verification tested with a test delivery
- [ ] Idempotency tested: re-sending the same `reference` did not
      create a duplicate
- [ ] Test script deleted before production deploy
- [ ] Server clock synchronised (NTP) — verify the `epoch` value
      stays within 30 seconds of the server's clock
- [ ] Switch `.env` values to **production** credentials from
      [CHIP Control → Settings → Applications](https://portal.chip-in.asia/control/settings/applications)
- [ ] Switch base URL from `staging-api.chip-in.asia` to
      `api.chip-in.asia`
- [ ] No sensitive data in logs (especially the API Secret, which
      must never appear anywhere outside the server)

---

## Common Issues & Fixes

| Problem | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` with no detail | `epoch` is more than 30 s off the server clock | NTP-sync the server; verify with `date +%s` against an NTP source |
| `401 Unauthorized` with checksum error | Wrong signing string or encoding | Verify: (a) string is `<epoch><api_key>` **no separator**, (b) the message is a *string* not JSON, (c) output is **hex** (not base64), (d) **SHA-512** (not SHA-256) |
| `401 Unauthorized` with auth error | `Authorization: Bearer <API Key>` header missing/malformed | Confirm header is present and the API Key is correct |
| `400 Bad Request` on a valid-looking payload | `epoch` or `checksum` header missing or has unexpected characters | All three headers required on every request |
| Works in Postman, fails from code | Checksum is being computed once and reused | Recompute checksum with a fresh `epoch` for every request |
| `403 Forbidden` on create-send-instruction | Insufficient balance | Call `POST /send/send_limits` to allocate more, or wait for the existing allocation to be approved |
| Recipient never receives the email | `send_recipient_receipt` is `false`, or email went to spam | Set the field to `true`; verify the recipient's email address |
| `amount` field rejected as "must be string" | Sent a JSON number instead of a string | Send `"100"` (string) — Send requires string amounts to avoid float precision loss |

---

## Available SDKs & Plugins

| Type | Options |
|---|---|
| Libraries | See https://github.com/CHIPAsia for the current list. CHIP Send ships with raw-HTTP examples only at the moment. |
| Plugins | None at the moment. CHIP Send is payouts-only and used directly by merchant backends. |

If a ready-made SDK exists for the user's language, recommend it
over raw HTTP. Otherwise, use the language examples in
**How to compute the checksum** as the starting point.

---

## References

- API Docs: https://docs.chip-in.asia/chip-send/api-reference/introduction
- OpenAPI Spec: https://docs.chip-in.asia/openapi/chip-send.yaml
- Merchant Portal: https://portal.chip-in.asia/control/settings/applications
- GitHub: https://github.com/CHIPAsia
- Related skill (CHIP Collect): `npx -y github:CHIPAsia/skill`
