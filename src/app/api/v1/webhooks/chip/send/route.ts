import { supabaseAdmin } from "@/services/supabase/admin";
import {
  chipBankAccountOutcome,
  chipSendAmountToCents,
  chipSendOutcome,
} from "@/services/chip/send";
import { settleBankAccountVerification } from "@/services/payouts/bank-account";
import { settlePayout } from "@/services/payouts/settle";
import { redactDigits } from "@/services/payouts/send-errors";
import { settlePrizeAward } from "@/services/prizes/settle";
import { onPlayerBankVerdict } from "@/services/prizes/execute";
import { afterResponse } from "@/lib/http/after-response";
import { normalizePublicKey } from "@/services/chip/public-key";
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { withAuditContext } from "@/services/supabase/audit-context";

export const runtime = "nodejs";

const SIGNATURE_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BANK_ACCOUNT_EVENT = "bank_account_status";
const SEND_INSTRUCTION_EVENT = "send_instruction_status";

interface ChipSendBankAccountObject {
  id?: number | string;
  reference?: string | null;
  status?: string;
  rejection_reason?: string | null;
  account_number?: string;
  bank_code?: string;
}

interface ChipSendInstructionObject {
  id?: number | string;
  reference?: string | null;
  state?: string;
  amount?: unknown;
  receipt_url?: string | null;
  rejection_reason?: string | null;
}

type ChipSendWebhookObject = ChipSendBankAccountObject & ChipSendInstructionObject;

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
  if (!header || !SIGNATURE_RE.test(header)) return false;
  try {
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

function eventTypeOf(
  header: string | null,
  obj: ChipSendWebhookObject,
): string {
  const named = header?.trim().toLowerCase();
  if (named) return named;
  if (obj.account_number !== undefined || obj.bank_code !== undefined) {
    return BANK_ACCOUNT_EVENT;
  }
  if (obj.state !== undefined) return SEND_INSTRUCTION_EVENT;
  return "";
}

function toChipId(id: unknown): number | null {
  const n = typeof id === "string" ? Number(id) : id;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

const BANK_ACCOUNT_TABLES = [
  "organization_bank_accounts",
  "player_bank_accounts",
] as const;

async function findBankAccount(
  table: (typeof BANK_ACCOUNT_TABLES)[number],
  reference: string | null | undefined,
  chipId: number | null,
): Promise<{ id: string | null } | { error: NextResponse }> {
  if (reference && UUID_RE.test(reference)) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id")
      .eq("id", reference)
      .maybeSingle();
    if (error) {
      return {
        error: internalErrorResponse(
          `CHIP Send webhook: failed to look up bank account ${reference} in ${table}; asking CHIP to redeliver`,
          error,
        ),
      };
    }
    const id = (data as { id: string } | null)?.id ?? null;
    if (id) return { id };
  }

  if (chipId !== null) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id")
      .eq("chip_bank_account_id", chipId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return {
        error: internalErrorResponse(
          `CHIP Send webhook: failed to look up the bank account for recipient ${chipId} in ${table}; asking CHIP to redeliver`,
          error,
        ),
      };
    }
    return { id: (data as { id: string } | null)?.id ?? null };
  }

  return { id: null };
}

async function handleBankAccountEvent(
  obj: ChipSendBankAccountObject,
): Promise<NextResponse> {
  const outcome = chipBankAccountOutcome(obj.status);
  if (outcome === "pending") return ack();

  const chipId = toChipId(obj.id);

  let bankAccountId: string | null = null;

  search: for (const by of ["reference", "chip_id"] as const) {
    for (const table of BANK_ACCOUNT_TABLES) {
      const found = await findBankAccount(
        table,
        by === "reference" ? obj.reference : null,
        by === "chip_id" ? chipId : null,
      );
      if ("error" in found) return found.error;
      bankAccountId = found.id;
      if (bankAccountId) break search;
    }
  }

  if (!bankAccountId) {
    console.warn("CHIP Send webhook: bank account event with no matching row", {
      status: obj.status ?? null,
      chipId,
    });
    return ack();
  }

  const { error, playerVerdict } = await settleBankAccountVerification({
    bankAccountId,
    chipBankAccountId: chipId,
    verified: outcome === "verified",
    reason: obj.rejection_reason,
  });

  if (error) {
    if (error.code === "P0002") return ack();
    return internalErrorResponse(
      `CHIP Send webhook: failed to settle bank account ${bankAccountId}; asking CHIP to redeliver`,
      error,
    );
  }

  if (playerVerdict) {
    afterResponse(() =>
      onPlayerBankVerdict(playerVerdict.userId, playerVerdict.verified),
    );
  }

  return ack();
}

async function findPrizeAward(
  reference: string | null | undefined,
  chipId: number | null,
): Promise<{ id: string | null } | { error: NextResponse }> {
  if (reference && UUID_RE.test(reference)) {
    const { data, error } = await supabaseAdmin
      .from("prize_awards")
      .select("id")
      .eq("id", reference)
      .maybeSingle();
    if (error) {
      return {
        error: internalErrorResponse(
          `CHIP Send webhook: failed to look up prize award ${reference}; asking CHIP to redeliver`,
          error,
        ),
      };
    }
    const id = (data as { id: string } | null)?.id ?? null;
    if (id) return { id };
  }
  if (chipId !== null) {
    const { data, error } = await supabaseAdmin
      .from("prize_awards")
      .select("id")
      .eq("chip_send_instruction_id", chipId)
      .maybeSingle();
    if (error) {
      return {
        error: internalErrorResponse(
          `CHIP Send webhook: failed to look up the prize award for instruction ${chipId}; asking CHIP to redeliver`,
          error,
        ),
      };
    }
    return { id: (data as { id: string } | null)?.id ?? null };
  }
  return { id: null };
}

function failureReasonOf(obj: ChipSendInstructionObject): string {
  return `send_instruction_${(obj.state ?? "failed").toLowerCase()}`;
}

async function settleAwardFromWebhook(
  awardId: string,
  obj: ChipSendInstructionObject,
  chipId: number | null,
  paid: boolean,
): Promise<NextResponse> {
  const { error } = await settlePrizeAward({
    awardId,
    chipSendInstructionId: chipId,
    paid,
    amountCents: paid ? chipSendAmountToCents(obj.amount) : null,
    receiptUrl: paid ? obj.receipt_url : null,
    failureReason: paid ? null : failureReasonOf(obj),
  });
  if (error) {
    if (error.code === "P0002") return ack();
    return internalErrorResponse(
      `CHIP Send webhook: settle_prize_award failed for award ${awardId} (${paid ? "paid" : "failed"}); asking CHIP to redeliver`,
      error,
    );
  }
  return ack();
}

async function handleSendInstructionEvent(
  obj: ChipSendInstructionObject,
): Promise<NextResponse> {
  const outcome = chipSendOutcome(obj.state);
  const chipId = toChipId(obj.id);

  console.info("CHIP Send webhook: send instruction event", {
    state: obj.state ?? null,
    chipId,
    reference: obj.reference ?? null,
    outcome,
    rejectionReason: obj.rejection_reason
      ? redactDigits(obj.rejection_reason)
      : null,
  });

  if (outcome === "pending") return ack();

  let payoutId: string | null = null;

  if (obj.reference && UUID_RE.test(obj.reference)) {
    const { data, error } = await supabaseAdmin
      .from("payouts")
      .select("id")
      .eq("id", obj.reference)
      .maybeSingle();
    if (error) {
      return internalErrorResponse(
        `CHIP Send webhook: failed to look up payout ${obj.reference}; asking CHIP to redeliver`,
        error,
      );
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
      return internalErrorResponse(
        `CHIP Send webhook: failed to look up the payout for instruction ${chipId}; asking CHIP to redeliver`,
        error,
      );
    }
    payoutId = (data as { id: string } | null)?.id ?? null;
  }

  const paid = outcome === "completed";

  if (!payoutId) {
    const award = await findPrizeAward(obj.reference, chipId);
    if ("error" in award) return award.error;
    if (award.id) return settleAwardFromWebhook(award.id, obj, chipId, paid);

    console.warn("CHIP Send webhook: send instruction event with no matching payout or prize award", {
      chipId,
      reference: obj.reference ?? null,
    });
    return ack();
  }

  const { error } = await settlePayout({
    payoutId,
    chipSendInstructionId: chipId,
    paid,
    amountCents: paid ? chipSendAmountToCents(obj.amount) : null,
    receiptUrl: paid ? obj.receipt_url : null,
    failureReason: paid ? null : failureReasonOf(obj),
  });

  if (error) {
    if (error.code === "P0002") {
      console.warn(
        `CHIP Send webhook: payout ${payoutId} disappeared before it could be settled`,
      );
      return ack();
    }
    return internalErrorResponse(
      `CHIP Send webhook: settle_payout failed for payout ${payoutId} (${paid ? "paid" : "failed"}); asking CHIP to redeliver`,
      error,
    );
  }

  return ack();
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const raw = await request.text();

  const publicKey = webhookPublicKey();
  if (!publicKey) {
    return serverError("Webhook not configured");
  }

  if (!signatureValid(raw, request.headers.get("x-signature"), publicKey)) {
    console.warn("CHIP Send webhook: invalid or missing X-Signature; ignored");
    return ack();
  }

  let obj: ChipSendWebhookObject;
  try {
    obj = JSON.parse(raw) as ChipSendWebhookObject;
  } catch {
    console.warn("CHIP Send webhook: signed body is not valid JSON; ignored");
    return ack();
  }
  if (!obj || typeof obj !== "object") return ack();

  switch (eventTypeOf(request.headers.get("event-type"), obj)) {
    case BANK_ACCOUNT_EVENT:
      return handleBankAccountEvent(obj);
    case SEND_INSTRUCTION_EVENT:
      return handleSendInstructionEvent(obj);
    default:
      return ack();
  }
}

export const POST = withAuditContext("webhook.chip-send", handlePost);
