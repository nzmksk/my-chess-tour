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

function chipSendBaseUrl(): string {
  const url = process.env.CHIP_SEND_API_URL;
  if (!url) {
    throw new Error("CHIP_SEND_API_URL must be configured");
  }
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

export class ChipSendError extends Error {
  readonly status: number;
  readonly body: string;
  readonly insufficientBalance: boolean;

  constructor(status: number, body: string, insufficientBalance = false) {
    super(
      insufficientBalance
        ? `CHIP Send insufficient balance (${status}): ${body}`
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
      (res.status === 403 && !!options.forbiddenMeansInsufficientBalance) ||
        (res.status === 400 && /balance not enough/i.test(text)),
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

export function toChipSendLimitAmount(amountCents: number): number {
  assertCents(amountCents);
  return amountCents / 100;
}

export function toChipSendInstructionAmount(amountCents: number): string {
  assertCents(amountCents);
  const ringgit = Math.floor(amountCents / 100);
  const sen = (amountCents % 100).toString().padStart(2, "0");
  return `${ringgit}.${sen}`;
}

export function chipSendAmountToCents(amount: unknown): number | null {
  const text = typeof amount === "number" ? String(amount) : amount;
  if (typeof text !== "string") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export async function getChipSendAccounts(): Promise<
  ChipSendList<ChipSendAccount>
> {
  return chipSendRequest("GET", "/send/accounts");
}

export async function increaseChipSendLimit(
  amountCents: number,
): Promise<ChipSendLimit> {
  const body: ChipSendLimitRequest = {
    amount: toChipSendLimitAmount(amountCents),
  };
  return chipSendRequest("POST", "/send/send_limits", body);
}

export async function getChipSendLimit(id: number): Promise<ChipSendLimit> {
  return chipSendRequest(
    "GET",
    `/send/send_limits/${encodeURIComponent(String(id))}`,
  );
}

export async function resendChipSendLimitApproval(
  id: number,
): Promise<ChipSendResendApprovalResponse> {
  return chipSendRequest(
    "POST",
    `/send/send_limits/${encodeURIComponent(String(id))}/resend_approval_requests`,
  );
}

export async function registerChipBankAccount(
  request: ChipBankAccountRequest,
): Promise<ChipBankAccount> {
  return chipSendRequest("POST", "/send/bank_accounts", request);
}

const DESCRIPTION_DISALLOWED = /[^A-Za-z0-9 ._\-/@()]+/g;
const DESCRIPTION_MAX_LENGTH = 140;

export function toChipSendDescription(text: string, fallback = "Payout"): string {
  const cleaned = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2018\u2019]/g, "")
    .replace(DESCRIPTION_DISALLOWED, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DESCRIPTION_MAX_LENGTH)
    .trim();
  return cleaned || fallback;
}

export interface CreateChipSendInstructionInput
  extends Omit<ChipSendInstructionRequest, "amount"> {
  amountCents: number;
}

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

export async function getChipSendInstruction(
  id: number,
): Promise<ChipSendInstruction> {
  return chipSendRequest(
    "GET",
    `/send/send_instructions/${encodeURIComponent(String(id))}`,
  );
}

export type ChipSendOutcome = "completed" | "failed" | "pending";

const SEND_COMPLETED = new Set(["completed", "send_instruction.completed"]);
const SEND_FAILED = new Set([
  "rejected",
  "deleted",
  "failed",
  "send_instruction.rejected",
  "send_instruction.deleted",
  "send_instruction.failed",
]);

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
