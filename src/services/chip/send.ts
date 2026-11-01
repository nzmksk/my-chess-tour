import crypto from "node:crypto";
import type { ChipSendList } from "./interfaces/send-common";
import type { ChipSendAccount } from "./interfaces/send-account";
import type {
  ChipSendLimit,
  ChipSendLimitRequest,
  ChipSendResendApprovalResponse,
} from "./interfaces/send-limit";
import type {
  ChipBankAccount,
  ChipBankAccountRequest,
} from "./interfaces/send-bank-account";
import type {
  ChipSendInstruction,
  ChipSendInstructionRequest,
} from "./interfaces/send-instruction";

// CHIP Send client — payouts. Deliberately a separate module from chip.ts
// (Collect): different host, a three-header auth scheme, string amounts on send
// instructions, and HMAC-SHA512/hex webhooks instead of RSA/base64. Sharing code
// between the two invites exactly the cross-wiring the vendor warns about.
//
// Spec (the source of truth — re-check it before adding an endpoint):
//   https://docs.chip-in.asia/openapi/chip-send.yaml
//
// THREE LANDMINES, each pinned by src/services/chip/__tests__/send.test.ts:
//
//   1. `send_limits.amount` is a JSON NUMBER; `send_instructions.amount` is a
//      STRING. The exported functions take integer cents and do the conversion,
//      so no caller ever builds either body by hand.
//
//   2. The epoch + checksum must be recomputed for EVERY request. CHIP rejects an
//      epoch more than ~30 s off its clock, and the vendor calls a memoized
//      checksum the single most common integration bug. chipSendHeaders() is
//      therefore a function, called per request, and must never be cached.
//
//   3. A 403 on create-send-instruction means INSUFFICIENT BALANCE (allocate
//      more with increaseChipSendLimit, or wait for approval), not a permissions
//      problem. ChipSendError.insufficientBalance flags it.
//
// UNITS: the spec documents every Send amount in RINGGIT ("1 for RM 1"; send
// instruction amounts are "floating point with maximum of 2 decimal places",
// e.g. "12.44") — whereas CHIP's skill notes describe them as MYR × 100 like
// Collect. The spec wins, and it is also the safe side of the ambiguity: if the
// skill notes were right, converting cents → ringgit makes us send 1/100 of the
// intended amount (a payout that is visibly too small) rather than 100× (money
// gone). Confirm against the sandbox before the first real payout (Phase 5).

const DEFAULT_CHIP_SEND_API_URL = "https://staging-api.chip-in.asia/api";

function chipSendBaseUrl(): string {
  // Unlike chip.ts, not hardcoded: staging and production are different hosts
  // and the credentials are per-environment.
  const url = process.env.CHIP_SEND_API_URL || DEFAULT_CHIP_SEND_API_URL;
  return url.replace(/\/+$/, "");
}

function chipSendCredentials(): { apiKey: string; apiSecret: string } {
  const apiKey = process.env.CHIP_SEND_API_KEY;
  const apiSecret = process.env.CHIP_SEND_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error(
      "CHIP_SEND_API_KEY and CHIP_SEND_API_SECRET must be configured",
    );
  }
  return { apiKey, apiSecret };
}

/**
 * The CHIP Send request checksum: lowercase hex HMAC-SHA512, keyed on the API
 * Secret, over `epoch + apiKey` concatenated with NO separator.
 */
export function chipSendChecksum(
  epoch: string | number,
  apiKey: string,
  apiSecret: string,
): string {
  return crypto
    .createHmac("sha512", apiSecret)
    .update(`${epoch}${apiKey}`)
    .digest("hex");
}

/**
 * The three auth headers (plus Content-Type) for one CHIP Send request, with a
 * fresh epoch. Call it per request — never memoize the result (landmine 2).
 */
export function chipSendHeaders(): Record<string, string> {
  const { apiKey, apiSecret } = chipSendCredentials();
  const epoch = Math.floor(Date.now() / 1000).toString();
  return {
    Authorization: `Bearer ${apiKey}`,
    epoch,
    checksum: chipSendChecksum(epoch, apiKey, apiSecret),
    "Content-Type": "application/json",
  };
}

/**
 * A non-2xx response from CHIP Send. Carries the HTTP status and response body
 * for diagnosis, and deliberately NOTHING about the request: the headers hold
 * the bearer key and a checksum derived from the secret, and this error is
 * written to logs.
 */
export class ChipSendError extends Error {
  readonly status: number;
  readonly body: string;
  /** True for a 403 on create-send-instruction — see landmine 3. */
  readonly insufficientBalance: boolean;

  constructor(status: number, body: string, insufficientBalance = false) {
    super(
      insufficientBalance
        ? `CHIP Send insufficient balance (403): ${body}`
        : `CHIP Send API error ${status}: ${body}`,
    );
    this.name = "ChipSendError";
    this.status = status;
    this.body = body;
    this.insufficientBalance = insufficientBalance;
  }
}

async function chipSendRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options: { forbiddenMeansInsufficientBalance?: boolean } = {},
): Promise<T> {
  const res = await fetch(`${chipSendBaseUrl()}${path}`, {
    method,
    headers: chipSendHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ChipSendError(
      res.status,
      text,
      res.status === 403 && !!options.forbiddenMeansInsufficientBalance,
    );
  }

  return res.json() as Promise<T>;
}

function assertCents(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(
      `CHIP Send amount must be a positive integer number of cents, got ${amountCents}`,
    );
  }
}

/** Cents → the JSON number a send limit takes (ringgit). 12345 → 123.45. */
export function toChipSendLimitAmount(amountCents: number): number {
  assertCents(amountCents);
  return amountCents / 100;
}

/**
 * Cents → the string a send instruction takes (ringgit, exactly 2 dp). Built
 * with integer arithmetic, not toFixed on a float. 12345 → "123.45".
 */
export function toChipSendInstructionAmount(amountCents: number): string {
  assertCents(amountCents);
  const ringgit = Math.floor(amountCents / 100);
  const sen = (amountCents % 100).toString().padStart(2, "0");
  return `${ringgit}.${sen}`;
}

/** `GET /send/accounts` — balances and fees. Also the cheapest auth smoke test. */
export async function getChipSendAccounts(): Promise<
  ChipSendList<ChipSendAccount>
> {
  return chipSendRequest("GET", "/send/accounts");
}

/**
 * `POST /send/send_limits` — convert upcoming settlement into send budget.
 * Every approver is emailed; the allocation stays `pending` until all approve
 * (and expires if not approved by 12 PM MYT the next day).
 */
export async function increaseChipSendLimit(
  amountCents: number,
): Promise<ChipSendLimit> {
  const body: ChipSendLimitRequest = {
    amount: toChipSendLimitAmount(amountCents),
  };
  return chipSendRequest("POST", "/send/send_limits", body);
}

/** `POST /send/send_limits/{id}/resend_approval_requests`. */
export async function resendChipSendLimitApproval(
  id: number,
): Promise<ChipSendResendApprovalResponse> {
  return chipSendRequest(
    "POST",
    `/send/send_limits/${encodeURIComponent(String(id))}/resend_approval_requests`,
  );
}

/**
 * `POST /send/bank_accounts` — register a payout recipient. Idempotent on
 * `reference`. The response `status` may already be `verified`; otherwise the
 * outcome arrives via the bank-account webhook. Classify it with
 * `chipBankAccountOutcome`, never by reading `status` directly.
 */
export async function registerChipBankAccount(
  request: ChipBankAccountRequest,
): Promise<ChipBankAccount> {
  return chipSendRequest("POST", "/send/bank_accounts", request);
}

export interface CreateChipSendInstructionInput
  extends Omit<ChipSendInstructionRequest, "amount"> {
  /** Integer cents — formatted into the string CHIP expects. */
  amountCents: number;
}

/**
 * `POST /send/send_instructions` — pay a registered recipient. Idempotent on
 * `reference`. Throws a ChipSendError with `insufficientBalance: true` on 403.
 */
export async function createChipSendInstruction(
  input: CreateChipSendInstructionInput,
): Promise<ChipSendInstruction> {
  const { amountCents, ...rest } = input;
  const body: ChipSendInstructionRequest = {
    ...rest,
    amount: toChipSendInstructionAmount(amountCents),
  };
  return chipSendRequest("POST", "/send/send_instructions", body, {
    forbiddenMeansInsufficientBalance: true,
  });
}

/** `GET /send/send_instructions/{id}`. */
export async function getChipSendInstruction(
  id: number,
): Promise<ChipSendInstruction> {
  return chipSendRequest(
    "GET",
    `/send/send_instructions/${encodeURIComponent(String(id))}`,
  );
}

// ---------------------------------------------------------------------------
// Outcome classifiers. Same reason chipOutcome / chipRefundOutcome exist in
// chip.ts: the webhook path and the synchronous-response path must classify
// identically, so these are the ONLY places a Send state is interpreted.
//
// Each accepts a resource status and/or a webhook event type. The spec only
// names the subscription topics (bank_account_status, send_instruction_status),
// not the per-delivery event names, so both the status values and dotted
// event names (bank_account.verified, …) are recognised.
// ---------------------------------------------------------------------------

export type ChipSendOutcome = "completed" | "failed" | "pending";

const SEND_COMPLETED = new Set(["completed", "send_instruction.completed"]);
const SEND_FAILED = new Set([
  "rejected",
  "deleted",
  "send_instruction.rejected",
  "send_instruction.deleted",
]);

/**
 * Maps a send-instruction `state` and/or webhook event to an outcome. Only
 * `completed` is success; `rejected`/`deleted` are terminal failures. Every
 * other state — including `accepted`, which can still end `rejected` after
 * review — is `"pending"`.
 */
export function chipSendOutcome(
  state?: string,
  eventType?: string,
): ChipSendOutcome {
  const s = (state ?? "").toLowerCase();
  const e = (eventType ?? "").toLowerCase();
  if (SEND_COMPLETED.has(s) || SEND_COMPLETED.has(e)) return "completed";
  if (SEND_FAILED.has(s) || SEND_FAILED.has(e)) return "failed";
  return "pending";
}

export type ChipBankAccountOutcome = "verified" | "rejected" | "pending";

const BANK_VERIFIED = new Set(["verified", "bank_account.verified"]);
const BANK_REJECTED = new Set(["rejected", "bank_account.rejected"]);

/**
 * Maps a bank-account `status` and/or webhook event to an outcome. Anything
 * unrecognised — `pending`, `unverified`, missing — is `"pending"`: we wait for
 * the webhook rather than guess.
 */
export function chipBankAccountOutcome(
  status?: string,
  eventType?: string,
): ChipBankAccountOutcome {
  const s = (status ?? "").toLowerCase();
  const e = (eventType ?? "").toLowerCase();
  if (BANK_VERIFIED.has(s) || BANK_VERIFIED.has(e)) return "verified";
  if (BANK_REJECTED.has(s) || BANK_REJECTED.has(e)) return "rejected";
  return "pending";
}
