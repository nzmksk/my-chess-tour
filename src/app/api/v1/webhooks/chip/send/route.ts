import { supabaseAdmin } from "@/services/supabase/admin";
import { chipBankAccountOutcome } from "@/services/chip/send";
import { settleBankAccountVerification } from "@/services/payouts/bank-account";
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

// CHIP Send webhook. A SEPARATE route from the Collect webhook
// (webhooks/chip/route.ts) because the signature scheme differs: Send signs the
// raw body with HMAC-SHA512 keyed on the API Secret, hex-encoded in
// X-Signature; Collect uses an RSA public key and base64.
//
// Needs the Node.js runtime for `crypto` and the raw request body.
export const runtime = "nodejs";

const SIGNATURE_RE = /^[0-9a-f]{128}$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The OpenAPI spec names only the subscription topics (bank_account_status,
// budget_allocation_status, send_instruction_status), not the delivery body.
// We therefore accept the resource at the top level or wrapped in `data`, and
// the event name under any of the usual keys. Classification goes through
// chipBankAccountOutcome, which understands both resource statuses and dotted
// event names.
interface ChipSendBankAccountObject {
  id?: number | string;
  reference?: string | null;
  status?: string;
  rejection_reason?: string | null;
  account_number?: string;
  bank_code?: string;
}

interface ChipSendWebhookPayload extends ChipSendBankAccountObject {
  event_type?: string;
  event?: string;
  type?: string;
  data?: ChipSendBankAccountObject;
}

const ack = () =>
  NextResponse.json({ data: { received: true } }, { status: 200 });

const serverError = (message: string) =>
  NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message } },
    { status: 500 },
  );

function signatureValid(rawBody: string, header: string | null, secret: string): boolean {
  // Shape-check BEFORE comparing: timingSafeEqual throws on a length mismatch,
  // and Buffer.from(…, "hex") silently truncates at the first non-hex char.
  if (!header || !SIGNATURE_RE.test(header)) return false;
  const expected = crypto
    .createHmac("sha512", secret)
    .update(rawBody)
    .digest();
  return crypto.timingSafeEqual(expected, Buffer.from(header, "hex"));
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Must read the raw body before parsing — the signature is over these bytes.
  const raw = await request.text();

  const secret = process.env.CHIP_SEND_API_SECRET;
  if (!secret) {
    // Our misconfiguration, not a bad delivery: 500 so CHIP keeps retrying
    // until the secret is set, instead of the events being silently dropped.
    console.error("CHIP Send webhook: CHIP_SEND_API_SECRET is not configured");
    return serverError("Webhook not configured");
  }

  // ⚠️ DELIBERATE DIVERGENCE from the Collect webhook, which answers 401 to a
  // bad signature. For Send, CHIP's guidance is to answer 200 and skip
  // processing: any 4xx makes CHIP retry the delivery. Do not "fix" this back
  // to 401.
  if (!signatureValid(raw, request.headers.get("x-signature"), secret)) {
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
  const obj: ChipSendBankAccountObject =
    payload.data && typeof payload.data === "object" ? payload.data : payload;

  if (isBankAccountEvent(eventType, obj)) {
    return handleBankAccountEvent(obj, eventType);
  }

  // Send-instruction and budget-allocation events are handled in Phase 5;
  // acknowledge so CHIP stops retrying.
  return ack();
}
