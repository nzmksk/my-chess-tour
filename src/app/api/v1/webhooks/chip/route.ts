import { supabaseAdmin } from "@/services/supabase/admin";
import {
  chipOutcome,
  chipRefundOutcome,
  isChipRefundEvent,
} from "@/services/chip/chip";
import {
  PURGE_PROFILE,
  TOURNAMENTS_LIST_TAG,
  tournamentTag,
} from "@/lib/cache-tags";
import { revalidateTag } from "next/cache";
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
  // The nested Purchase carries the total CHIP charged (smallest currency unit),
  // used to guard against settling a stale/re-priced purchase.
  purchase?: { total?: number };
  // The instrument the payer used (raw CHIP value, e.g. "fpx_b2c", "visa"),
  // recorded on the payment at settlement.
  transaction_data?: { payment_method?: string };
  // On a `payment.refunded` event the payload is a refund Payment object whose
  // `related_to` links back to the original purchase. Shape is undocumented, so
  // we parse it defensively (object with id, bare id, or URL) — see
  // extractRelatedPurchaseId.
  related_to?: { id?: string } | string | null;
}

// Extracts the original purchase id from a `payment.refunded` payload's
// `related_to`. Tolerates the three plausible shapes: an object `{ id }`, a bare
// id string, or a URL whose last path segment is the id. Returns null if none fit
// so the caller can warn rather than mis-correlate.
function extractRelatedPurchaseId(
  relatedTo: ChipCallbackPayload["related_to"],
): string | null {
  if (!relatedTo) return null;
  if (typeof relatedTo === "object") return relatedTo.id ?? null;
  const value = relatedTo.trim();
  if (!value) return null;
  if (value.includes("/")) {
    const segments = value.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? null;
  }
  return value;
}

const ack = () =>
  NextResponse.json({ data: { received: true } }, { status: 200 });

// Handles the three CHIP refund events (payment.refunded / purchase.refund_failure
// / purchase.pending_refund). Correlates the delivery back to a pending refund row
// and settles it via settle_refund. Mirrors the main handler's ack/500 discipline:
// ack (200) so CHIP stops retrying once we've either settled or found nothing to
// correlate; 500 only on a transient DB error so CHIP re-delivers.
async function handleRefundEvent(
  payload: ChipCallbackPayload,
): Promise<NextResponse> {
  const outcome = chipRefundOutcome(payload.status, payload.event_type);
  if (outcome === "pending") {
    // pending_refund — the acquirer is still processing; the authoritative
    // `payment.refunded` event settles it later. Ack without changing state.
    return ack();
  }
  const paid = outcome === "refunded";

  // The success event carries a refund Payment whose `related_to` points at the
  // original purchase; the failure/pending events carry the original Purchase
  // directly (payload.id). Prefer related_to, fall back to payload.id.
  const originalPurchaseId =
    extractRelatedPurchaseId(payload.related_to) ?? payload.id ?? null;
  if (!originalPurchaseId) {
    console.warn("CHIP webhook: refund event with no correlatable purchase id", {
      event: payload.event_type,
    });
    return ack();
  }

  // original purchase id → the paid registration payment → its registration.
  const { data: regPayment, error: regErr } = await supabaseAdmin
    .from("payments")
    .select("registration_id")
    .eq("chip_transaction_id", originalPurchaseId)
    .eq("type", "registration")
    .maybeSingle();
  if (regErr) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: regErr.message } },
      { status: 500 },
    );
  }
  if (!regPayment?.registration_id) {
    console.warn("CHIP webhook: refund event, no matching registration payment", {
      originalPurchaseId,
      event: payload.event_type,
    });
    return ack();
  }

  // → the live (non-rejected) refund row for that registration.
  const { data: refund, error: refundErr } = await supabaseAdmin
    .from("refunds")
    .select("id")
    .eq("registration_id", regPayment.registration_id)
    .neq("status", "rejected")
    .maybeSingle();
  if (refundErr) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: refundErr.message } },
      { status: 500 },
    );
  }
  if (!refund?.id) {
    // No pending refund row — e.g. a refund issued out-of-band from CHIP's
    // dashboard. Ack and surface for ops rather than fabricate a refund.
    console.warn("CHIP webhook: refund event, no matching refund row", {
      registrationId: regPayment.registration_id,
      event: payload.event_type,
    });
    return ack();
  }

  // On success the refund Payment id (payload.id) is the CHIP refund id; a failure
  // event has none.
  const chipRefundId = paid ? (payload.id ?? null) : null;

  const { error: rpcErr } = await supabaseAdmin.rpc("settle_refund", {
    p_refund_id: refund.id,
    p_chip_refund_id: chipRefundId,
    p_paid: paid,
    p_payment_method: payload.transaction_data?.payment_method ?? null,
  });
  if (rpcErr) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: rpcErr.message } },
      { status: 500 },
    );
  }

  if (!paid) {
    console.error("CHIP webhook: refund failed", {
      refundId: refund.id,
      originalPurchaseId,
      event: payload.event_type,
    });
  }

  return ack();
}

// Normalizes a PEM read from an env var. Env managers store keys inconsistently:
// dotenv strips surrounding quotes and expands "\n", but platforms like Netlify
// store the value verbatim — so a key copied from a .env file can arrive wrapped
// in quotes and/or with literal "\n" sequences. Both break PEM parsing.
function normalizePublicKey(raw: string): string {
  let key = raw.trim();
  // Strip a single layer of matched surrounding quotes.
  if (
    key.length >= 2 &&
    ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'")))
  ) {
    key = key.slice(1, -1);
  }
  // Tolerate env values that carry literal "\n" instead of real newlines.
  return key.replace(/\\n/g, "\n");
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) {
    console.warn("CHIP webhook: missing X-Signature header");
    return false;
  }
  const publicKey = process.env.CHIP_WEBHOOK_PUBLIC_KEY;
  if (!publicKey) {
    console.error("CHIP webhook: CHIP_WEBHOOK_PUBLIC_KEY is not configured");
    return false;
  }
  const pem = normalizePublicKey(publicKey);
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(rawBody);
    verifier.end();
    const ok = verifier.verify(pem, signature, "base64");
    if (!ok) console.warn("CHIP webhook: signature did not match public key");
    return ok;
  } catch (err) {
    // Almost always a malformed PEM (e.g. surrounding quotes, missing newlines).
    console.error("CHIP webhook: public key parse/verify error", err);
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

  // Refund events settle a refund, not a registration — route them out before the
  // registration path so a refund can't be mistaken for a purchase settlement.
  if (isChipRefundEvent(payload.event_type, payload.status)) {
    return handleRefundEvent(payload);
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
  let payment: { id: string; chip_transaction_id: string | null } | null = null;
  if (purchaseId) {
    const { data, error } = await supabaseAdmin
      .from("payments")
      .select("id, chip_transaction_id")
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
      .select("id, chip_transaction_id")
      .eq("id", reference)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: error.message } },
        { status: 500 },
      );
    }
    // Each attempt is its own immutable payment row whose id is its `reference`,
    // and settlement only terminalizes the registration for its *current*
    // attempt — so settling a superseded attempt here is a harmless no-op on the
    // registration. No stale-purchase guard needed.
    payment = data;
  }

  if (!payment) {
    console.warn("CHIP webhook: no matching payment", {
      purchaseId,
      reference,
    });
    return NextResponse.json({ data: { received: true } }, { status: 200 });
  }

  const { data: settled, error: rpcErr } = await supabaseAdmin.rpc(
    "settle_registration_payment",
    {
      p_payment_id: payment.id,
      p_paid: paid,
      p_amount_cents: payload.purchase?.total ?? null,
      p_payment_method: payload.transaction_data?.payment_method ?? null,
    },
  );

  if (rpcErr) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: rpcErr.message } },
      { status: 500 },
    );
  }

  const result = settled as {
    amount_mismatch?: boolean;
    registration_id?: string;
  } | null;

  if (result?.amount_mismatch) {
    // Paid amount didn't match the recorded total — left pending for manual
    // reconciliation. Ack so CHIP stops retrying; surface loudly for ops.
    console.error("CHIP webhook: amount mismatch, payment left pending", {
      paymentId: payment.id,
      purchaseId,
      paidAmount: payload.purchase?.total,
    });
  } else if (paid && result?.registration_id) {
    // A paid settlement moves the registration to `confirmed`, which is the only
    // transition that changes the (confirmed-only) capacity shown on the public
    // pages. This webhook is the authoritative settlement path (CHIP retries on
    // failure), so it's where we broadcast the cache invalidation. Resolve the
    // tournament slug from the settled registration to target its detail tag.
    const { data: reg } = await supabaseAdmin
      .from("registrations")
      .select("tournaments(slug)")
      .eq("id", result.registration_id)
      .maybeSingle();
    const tRaw = (
      reg as { tournaments?: { slug: string } | { slug: string }[] } | null
    )?.tournaments;
    const slug = Array.isArray(tRaw) ? tRaw[0]?.slug : tRaw?.slug;

    revalidateTag(TOURNAMENTS_LIST_TAG, PURGE_PROFILE);
    if (slug) revalidateTag(tournamentTag(slug), PURGE_PROFILE);
  }

  return NextResponse.json({ data: { received: true } }, { status: 200 });
}
