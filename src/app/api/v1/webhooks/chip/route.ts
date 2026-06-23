import { supabaseAdmin } from "@/services/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

// Needs the Node.js runtime for `crypto` and access to the raw request body.
export const runtime = "nodejs";

// CHIP delivers a Purchase object. `reference_id` is our payments.id (set when
// the purchase was created) and `id` is the CHIP purchase id we stored as
// payments.chip_transaction_id. Account-level webhooks also include `event_type`.
interface ChipCallbackPayload {
  id?: string;
  reference_id?: string;
  status?: string;
  event_type?: string;
}

// CHIP purchase statuses / webhook events that mean the money cleared.
const SUCCESS_STATUSES = new Set(["paid"]);
const SUCCESS_EVENTS = new Set(["purchase.paid"]);
// Terminal failure signals. (Other statuses like "created"/"pending" are ignored.)
const FAILURE_STATUSES = new Set(["error", "expired", "cancelled", "overdue"]);
const FAILURE_EVENTS = new Set([
  "purchase.payment_failure",
  "purchase.expired",
  "purchase.cancelled",
]);

function verifySignature(rawBody: string, signature: string | null): boolean {
  const publicKey = process.env.CHIP_WEBHOOK_PUBLIC_KEY;
  if (!signature || !publicKey) return false;
  // Tolerate env values that carry literal "\n" instead of real newlines.
  const pem = publicKey.replace(/\\n/g, "\n");
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(pem, signature, "base64");
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Must read the raw body before parsing — the signature is over these bytes.
  const raw = await request.text();

  if (!verifySignature(raw, request.headers.get("x-signature"))) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_SIGNATURE",
          message: "Signature verification failed",
        },
      },
      { status: 401 },
    );
  }

  let payload: ChipCallbackPayload;
  try {
    payload = JSON.parse(raw) as ChipCallbackPayload;
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  const referenceId = payload.reference_id;
  if (!referenceId) {
    // Nothing to correlate; ack so CHIP stops retrying.
    console.warn("CHIP webhook: missing reference_id", {
      event: payload.event_type,
    });
    return NextResponse.json({ data: { received: true } }, { status: 200 });
  }

  const status = (payload.status ?? "").toLowerCase();
  const event = (payload.event_type ?? "").toLowerCase();

  let paid: boolean;
  if (SUCCESS_STATUSES.has(status) || SUCCESS_EVENTS.has(event)) {
    paid = true;
  } else if (FAILURE_STATUSES.has(status) || FAILURE_EVENTS.has(event)) {
    paid = false;
  } else {
    // Intermediate / unrelated event — acknowledge without changing state.
    return NextResponse.json({ data: { received: true } }, { status: 200 });
  }

  // Defense-in-depth: confirm the payment exists and the CHIP purchase id matches.
  const { data: payment, error: payErr } = await supabaseAdmin
    .from("payments")
    .select("id, chip_transaction_id")
    .eq("id", referenceId)
    .maybeSingle();

  if (payErr) {
    // Transient DB error — return 5xx so CHIP retries delivery.
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: payErr.message } },
      { status: 500 },
    );
  }

  if (!payment) {
    console.warn("CHIP webhook: no payment for reference_id", { referenceId });
    return NextResponse.json({ data: { received: true } }, { status: 200 });
  }

  if (
    payload.id &&
    payment.chip_transaction_id &&
    payment.chip_transaction_id !== payload.id
  ) {
    console.warn("CHIP webhook: purchase id mismatch", {
      referenceId,
      expected: payment.chip_transaction_id,
      received: payload.id,
    });
    return NextResponse.json({ data: { received: true } }, { status: 200 });
  }

  const { error: rpcErr } = await supabaseAdmin.rpc(
    "settle_registration_payment",
    {
      p_payment_id: payment.id,
      p_paid: paid,
    },
  );

  if (rpcErr) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: rpcErr.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: { received: true } }, { status: 200 });
}
