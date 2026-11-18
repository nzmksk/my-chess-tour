import { supabaseAdmin } from "@/services/supabase/admin";
import { normalizePublicKey } from "@/services/chip/public-key";
import {
  chipOutcome,
  chipRefundOutcome,
  isChipRefundEvent,
} from "@/services/chip/chip";
import {
  PURGE_PROFILE,
  TOURNAMENTS_LIST_TAG,
  tournamentTag,
} from "@/lib/tournaments/cache-tags";
import { notifyRegistrationConfirmed } from "@/services/registrations/notify";
import {
  notifyRefundSettlement,
  type SettleRefundResult,
} from "@/services/refunds/notify";
import {
  findPrizeFundingForPurchase,
  settlePrizeFunding,
} from "@/services/prizes/funding";
import { onTournamentListed } from "@/services/prizes/funding-requests";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { afterResponse } from "@/lib/http/after-response";

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
    return internalErrorResponse(
      `CHIP webhook: failed to look up the registration payment for refunded purchase ${originalPurchaseId}; asking CHIP to redeliver`,
      regErr,
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
    return internalErrorResponse(
      `CHIP webhook: failed to look up the refund for registration ${regPayment.registration_id}; asking CHIP to redeliver`,
      refundErr,
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

  const { data: settled, error: rpcErr } = await supabaseAdmin.rpc("settle_refund", {
    p_refund_id: refund.id,
    p_chip_refund_id: chipRefundId,
    p_paid: paid,
    p_payment_method: payload.transaction_data?.payment_method ?? null,
  });
  if (rpcErr) {
    return internalErrorResponse(
      `CHIP webhook: settle_refund failed for refund ${refund.id} (${paid ? "refunded" : "failed"}); asking CHIP to redeliver`,
      rpcErr,
    );
  }

  if (!paid) {
    console.error("CHIP webhook: refund failed", {
      refundId: refund.id,
      originalPurchaseId,
      event: payload.event_type,
    });
  }

  // Emails the player only if this delivery settled the refund or recorded its
  // first failure; a duplicate or a refund the sync response already settled
  // sends nothing. Sent after the 200, so a Resend outage can't make CHIP
  // redeliver. Never throws.
  afterResponse(() =>
    notifyRefundSettlement(refund.id, settled as SettleRefundResult | null),
  );

  return ack();
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

  // A sponsor paying into a platform-distributed prize pool (#523) uses this
  // same webhook. Its purchase is a prize_fundings row, not a registration
  // payment, and must never reach settle_registration_payment: routed out
  // first, the way refunds are.
  const funding = await findPrizeFundingForPurchase(purchaseId, reference);
  if ("error" in funding) {
    return internalErrorResponse(
      `CHIP webhook: failed to look up a prize funding for purchase ${purchaseId ?? reference}; asking CHIP to redeliver`,
      funding.error,
    );
  }
  if (funding.id) {
    const {
      error: fundingError,
      wentLive,
      tournamentId,
    } = await settlePrizeFunding({
      fundingId: funding.id,
      paid,
      amountCents: payload.purchase?.total ?? null,
      paymentMethod: payload.transaction_data?.payment_method ?? null,
    });
    if (fundingError) {
      return internalErrorResponse(
        `CHIP webhook: settle_prize_funding failed for funding ${funding.id} (${paid ? "paid" : "failed"}); asking CHIP to redeliver`,
        fundingError,
      );
    }
    // The payment that completed the pool listed the tournament: show it now
    // and tell the organizer.
    if (wentLive && tournamentId) await onTournamentListed(tournamentId);
    return ack();
  }

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
      return internalErrorResponse(
        `CHIP webhook: failed to look up payment for purchase ${purchaseId}; asking CHIP to redeliver`,
        error,
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
      return internalErrorResponse(
        `CHIP webhook: failed to look up payment ${reference}; asking CHIP to redeliver`,
        error,
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
    return internalErrorResponse(
      `CHIP webhook: settle_registration_payment failed for payment ${payment.id} (${paid ? "paid" : "failed"}); asking CHIP to redeliver`,
      rpcErr,
    );
  }

  const result = settled as {
    amount_mismatch?: boolean;
    registration_id?: string;
    newly_confirmed?: boolean;
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

    // Only the settle that confirmed the registration reports it, so a retried
    // webhook or the success page's reconcile can't email the player twice.
    // Sent after the 200, since settlement has already committed. Never throws.
    if (result.newly_confirmed) {
      const registrationId = result.registration_id;
      afterResponse(() => notifyRegistrationConfirmed(registrationId));
    }
  }

  return NextResponse.json({ data: { received: true } }, { status: 200 });
}
