import { supabaseAdmin } from "@/services/supabase/admin";
import {
  chipBankAccountOutcome,
  chipSendAmountToCents,
  chipSendOutcome,
} from "@/services/chip/send";
import { settleBankAccountVerification } from "@/services/payouts/bank-account";
import { settlePayout } from "@/services/payouts/settle";
import { normalizePublicKey } from "@/services/chip/public-key";
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

// CHIP Send webhook. A SEPARATE route from the Collect webhook
// (webhooks/chip/route.ts). Both use RSA, but they differ:
//   * Send signs with SHA-512 (Collect: SHA-256);
//   * Send issues a public key PER WEBHOOK — the `public_key` returned by
//     POST/GET /webhooks — held in CHIP_SEND_WEBHOOK_PUBLIC_KEY. Collect has one
//     account-wide key.
//   * a bad signature is acked with 200 here (Collect: 401) — see POST below.
//
// X-Signature is a base64 RSA PKCS#1 v1.5 signature of the SHA-512 digest of
// the raw body:
//   https://docs.chip-in.asia/chip-send/api-reference/webhooks/validation
//
// Needs the Node.js runtime for `crypto` and the raw request body.
export const runtime = "nodejs";

// Standard base64, padding optional. Anything else can't be a signature.
const SIGNATURE_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The OpenAPI spec names only the subscription topics (bank_account_status,
// budget_allocation_status, send_instruction_status), not the delivery body.
// We therefore accept the resource at the top level or wrapped in `data`, and
// the event name under any of the usual keys. Classification goes through
// chipBankAccountOutcome / chipSendOutcome, which understand both resource
// statuses and dotted event names.
interface ChipSendBankAccountObject {
  id?: number | string;
  reference?: string | null;
  status?: string;
  rejection_reason?: string | null;
  account_number?: string;
  bank_code?: string;
}

// Field names follow the SendInstruction resource in the spec. The delivery body
// itself is undocumented, so every field is treated as possibly absent.
interface ChipSendInstructionObject {
  id?: number | string;
  reference?: string | null;
  state?: string;
  amount?: unknown;
  receipt_url?: string | null;
  bank_account_id?: number | string;
}

type ChipSendWebhookObject = ChipSendBankAccountObject & ChipSendInstructionObject;

interface ChipSendWebhookPayload extends ChipSendWebhookObject {
  event_type?: string;
  event?: string;
  type?: string;
  data?: ChipSendWebhookObject;
}

const ack = () =>
  NextResponse.json({ data: { received: true } }, { status: 200 });

const serverError = (message: string) =>
  NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message } },
    { status: 500 },
  );

function signatureValid(
  rawBody: string,
  header: string | null,
  publicKey: crypto.KeyObject,
): boolean {
  // Shape-check first: Buffer.from(…, "base64") silently skips invalid chars.
  if (!header || !SIGNATURE_RE.test(header)) return false;
  try {
    // RSA keys default to PKCS#1 v1.5 padding, which is what CHIP uses.
    return crypto.verify(
      "sha512",
      Buffer.from(rawBody, "utf8"),
      publicKey,
      Buffer.from(header, "base64"),
    );
  } catch {
    return false;
  }
}

// Parses CHIP_SEND_WEBHOOK_PUBLIC_KEY. null means it is unset or unparseable,
// which is OUR misconfiguration, not a bad delivery.
function webhookPublicKey(): crypto.KeyObject | null {
  const raw = process.env.CHIP_SEND_WEBHOOK_PUBLIC_KEY;
  if (!raw) {
    console.error("CHIP Send webhook: CHIP_SEND_WEBHOOK_PUBLIC_KEY is not configured");
    return null;
  }
  try {
    return crypto.createPublicKey(normalizePublicKey(raw));
  } catch (err) {
    console.error(
      "CHIP Send webhook: CHIP_SEND_WEBHOOK_PUBLIC_KEY is not a valid PEM public key",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function eventTypeOf(payload: ChipSendWebhookPayload): string {
  return String(payload.event_type ?? payload.event ?? payload.type ?? "");
}

function isBankAccountEvent(
  eventType: string,
  obj: ChipSendBankAccountObject,
): boolean {
  if (eventType) return eventType.toLowerCase().startsWith("bank_account");
  // No event name: recognise a bank-account resource by its own fields.
  return obj.account_number !== undefined || obj.bank_code !== undefined;
}

function isSendInstructionEvent(
  eventType: string,
  obj: ChipSendInstructionObject,
): boolean {
  if (eventType) return eventType.toLowerCase().startsWith("send_instruction");
  // No event name: recognise an instruction by its state field, which a bank
  // account (`status`) doesn't have.
  return obj.state !== undefined;
}

function toChipId(id: unknown): number | null {
  const n = typeof id === "string" ? Number(id) : id;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function handleBankAccountEvent(
  obj: ChipSendBankAccountObject,
  eventType: string,
): Promise<NextResponse> {
  const outcome = chipBankAccountOutcome(obj.status, eventType);
  if (outcome === "pending") return ack();

  const chipId = toChipId(obj.id);

  // Correlate on `reference` (our organization_bank_accounts.id, sent at
  // registration), falling back to CHIP's integer id.
  let bankAccountId: string | null = null;

  if (obj.reference && UUID_RE.test(obj.reference)) {
    const { data, error } = await supabaseAdmin
      .from("organization_bank_accounts")
      .select("id")
      .eq("id", obj.reference)
      .maybeSingle();
    if (error) return serverError(error.message);
    bankAccountId = (data as { id: string } | null)?.id ?? null;
  }

  if (!bankAccountId && chipId !== null) {
    // CHIP may hand back one recipient id for an identical (account, bank)
    // pair, so several of our rows can share it — take the newest.
    const { data, error } = await supabaseAdmin
      .from("organization_bank_accounts")
      .select("id")
      .eq("chip_bank_account_id", chipId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return serverError(error.message);
    bankAccountId = (data as { id: string } | null)?.id ?? null;
  }

  if (!bankAccountId) {
    console.warn("CHIP Send webhook: bank account event with no matching row", {
      event: eventType,
      chipId,
    });
    return ack();
  }

  const { error } = await settleBankAccountVerification({
    bankAccountId,
    chipBankAccountId: chipId,
    verified: outcome === "verified",
    reason: obj.rejection_reason,
  });

  if (error) {
    // The row vanished between lookup and settle — nothing to retry for.
    if (error.code === "P0002") return ack();
    // Transient DB failure: 500 so CHIP re-delivers.
    return serverError(error.message);
  }

  return ack();
}

async function handleSendInstructionEvent(
  obj: ChipSendInstructionObject,
  eventType: string,
): Promise<NextResponse> {
  const outcome = chipSendOutcome(obj.state, eventType);
  const chipId = toChipId(obj.id);

  // CHIP doesn't document this body, so record what each delivery carried. No
  // amounts, emails or account details: just enough to match it to a payout.
  console.info("CHIP Send webhook: send instruction event", {
    event: eventType || null,
    state: obj.state ?? null,
    chipId,
    reference: obj.reference ?? null,
    outcome,
  });

  // created / in_progress / anything unrecognised: nothing to settle yet.
  if (outcome === "pending") return ack();

  // Correlate on `reference` (our payouts.id, sent with the instruction), falling
  // back to CHIP's integer id.
  let payoutId: string | null = null;

  if (obj.reference && UUID_RE.test(obj.reference)) {
    const { data, error } = await supabaseAdmin
      .from("payouts")
      .select("id")
      .eq("id", obj.reference)
      .maybeSingle();
    if (error) {
      console.error(
        `CHIP Send webhook: failed to look up payout ${obj.reference}; asking CHIP to redeliver`,
        error.message,
      );
      return serverError(error.message);
    }
    payoutId = (data as { id: string } | null)?.id ?? null;
  }

  if (!payoutId && chipId !== null) {
    const { data, error } = await supabaseAdmin
      .from("payouts")
      .select("id")
      .eq("chip_send_instruction_id", chipId)
      .maybeSingle();
    if (error) {
      console.error(
        `CHIP Send webhook: failed to look up the payout for instruction ${chipId}; asking CHIP to redeliver`,
        error.message,
      );
      return serverError(error.message);
    }
    payoutId = (data as { id: string } | null)?.id ?? null;
  }

  if (!payoutId) {
    console.warn("CHIP Send webhook: send instruction event with no matching payout", {
      event: eventType,
      chipId,
      reference: obj.reference ?? null,
    });
    return ack();
  }

  const paid = outcome === "completed";
  // The state when there is one, else the last part of the event name. Either way
  // it lands on a code describePayoutFailure knows: rejected, deleted or failed.
  const failureCode =
    (obj.state ?? eventType.split(".").pop() ?? "failed").toLowerCase();

  const { error } = await settlePayout({
    payoutId,
    chipSendInstructionId: chipId,
    paid,
    // Null falls back to the amount we recorded when sending.
    amountCents: paid ? chipSendAmountToCents(obj.amount) : null,
    receiptUrl: paid ? obj.receipt_url : null,
    failureReason: paid ? null : `send_instruction_${failureCode}`,
  });

  if (error) {
    // The row vanished between lookup and settle — nothing to retry for.
    if (error.code === "P0002") {
      console.warn(
        `CHIP Send webhook: payout ${payoutId} disappeared before it could be settled`,
      );
      return ack();
    }
    // A DB failure: 500 so CHIP re-delivers. The money may already have left, so
    // this must not be swallowed.
    console.error(
      `CHIP Send webhook: settle_payout failed for payout ${payoutId} (${paid ? "paid" : "failed"}); asking CHIP to redeliver`,
      error.code ? `${error.code}: ${error.message}` : error.message,
    );
    return serverError(error.message);
  }

  return ack();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Must read the raw body before parsing — the signature is over these bytes.
  const raw = await request.text();

  const publicKey = webhookPublicKey();
  if (!publicKey) {
    // Our misconfiguration, not a bad delivery: 500 so CHIP keeps retrying
    // until the key is fixed, instead of the events being silently dropped.
    return serverError("Webhook not configured");
  }

  // ⚠️ DELIBERATE DIVERGENCE from the Collect webhook, which answers 401 to a
  // bad signature. For Send, CHIP's guidance is to answer 200 and skip
  // processing: any 4xx makes CHIP retry the delivery. Do not "fix" this back
  // to 401.
  if (!signatureValid(raw, request.headers.get("x-signature"), publicKey)) {
    console.warn("CHIP Send webhook: invalid or missing X-Signature; ignored");
    return ack();
  }

  let payload: ChipSendWebhookPayload;
  try {
    payload = JSON.parse(raw) as ChipSendWebhookPayload;
  } catch {
    // Signed but unparseable — redelivery won't fix it, so ack (same reason as
    // above) and leave a trace.
    console.warn("CHIP Send webhook: signed body is not valid JSON; ignored");
    return ack();
  }
  if (!payload || typeof payload !== "object") return ack();

  const eventType = eventTypeOf(payload);
  const obj: ChipSendWebhookObject =
    payload.data && typeof payload.data === "object" ? payload.data : payload;

  if (isBankAccountEvent(eventType, obj)) {
    return handleBankAccountEvent(obj, eventType);
  }

  if (isSendInstructionEvent(eventType, obj)) {
    return handleSendInstructionEvent(obj, eventType);
  }

  // Budget-allocation events change nothing here: a parked payout finds out by
  // re-checking the balance on its next execution. Acknowledge so CHIP stops retrying.
  return ack();
}
