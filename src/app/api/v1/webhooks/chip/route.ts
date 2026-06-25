import { supabaseAdmin } from "@/services/supabase/admin";
import { chipOutcome } from "@/services/chip/chip";
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

// Needs the Node.js runtime for `crypto` and access to the raw request body.
export const runtime = "nodejs";

// CHIP delivers the Purchase object. `id` is the CHIP purchase id we stored as
// payments.chip_transaction_id; `reference` is our payments.id (set as the
// purchase `reference`). Webhook deliveries also include `event_type`.
interface ChipCallbackPayload {
  id?: string;
  reference?: string;
  status?: string;
  event_type?: string;
}

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

  const purchaseId = payload.id;
  const reference = payload.reference;
  if (!purchaseId && !reference) {
    // Nothing to correlate; ack so CHIP stops retrying.
    console.warn("CHIP webhook: no id/reference to correlate", {
      event: payload.event_type,
    });
    return NextResponse.json({ data: { received: true } }, { status: 200 });
  }

  const outcome = chipOutcome(payload.status, payload.event_type);
  if (outcome === "pending") {
    // Intermediate / unrelated event — acknowledge without changing state.
    return NextResponse.json({ data: { received: true } }, { status: 200 });
  }
  const paid = outcome === "paid";

  // Correlate on the CHIP purchase id (stored as chip_transaction_id), which is
  // always set after checkout; fall back to our reference (payments.id).
  let payment: { id: string } | null = null;
  if (purchaseId) {
    const { data, error } = await supabaseAdmin
      .from("payments")
      .select("id")
      .eq("chip_transaction_id", purchaseId)
      .maybeSingle();
    if (error) {
      // Transient DB error — return 5xx so CHIP retries delivery.
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: error.message } },
        { status: 500 },
      );
    }
    payment = data;
  }

  if (!payment && reference) {
    const { data, error } = await supabaseAdmin
      .from("payments")
      .select("id")
      .eq("id", reference)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: error.message } },
        { status: 500 },
      );
    }
    payment = data;
  }

  if (!payment) {
    console.warn("CHIP webhook: no matching payment", {
      purchaseId,
      reference,
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
