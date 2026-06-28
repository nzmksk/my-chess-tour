import { supabaseAdmin } from "@/services/supabase/admin";
import {
  chipOutcome,
  getChipPurchase,
  PAYMENT_TIMEOUT_INTERVAL,
  PAYMENT_TIMEOUT_MINUTES,
} from "@/services/chip/chip";
import type { RegistrationRow } from "../types";

export type PaymentState = "confirmed" | "pending" | "failed" | "none";

export interface ResolvedPayment {
  state: PaymentState;
  registration: RegistrationRow | null;
}

function isExpired(registeredAt: string): boolean {
  return (
    Date.now() - new Date(registeredAt).getTime() >
    PAYMENT_TIMEOUT_MINUTES * 60_000
  );
}

/**
 * Terminalizes a still-pending registration whose payment window has lapsed.
 * The DB function re-checks the TTL + status, so it's authoritative: if it
 * expired nothing (e.g. a concurrent confirm), we stay pending rather than
 * wrongly reporting a failure. It leaves the payment row pending so a late
 * `paid` webhook can still rescue the registration; the CHIP `due` already made
 * the link unpayable, so no cancel is needed here.
 */
async function expireIfStale(reg: RegistrationRow): Promise<ResolvedPayment> {
  const { data } = await supabaseAdmin.rpc("expire_stale_pending_payments", {
    p_ttl: PAYMENT_TIMEOUT_INTERVAL,
    p_registration_id: reg.id,
  });

  if (!Array.isArray(data) || data.length === 0) {
    return { state: "pending", registration: reg };
  }

  return {
    state: "failed",
    registration: { ...reg, status: "cancelled_payment" },
  };
}

/**
 * Determines the true payment state for a user's registration in a tournament.
 *
 * The CHIP browser redirect to the success/failure pages can land before the
 * webhook has processed, so a `pending_payment` registration is reconciled
 * against CHIP (via getChipPurchase) and settled idempotently through the same
 * RPC the webhook uses. Network/CHIP errors degrade gracefully to "pending".
 */
export async function resolvePaymentState(
  tournamentId: string,
  userId: string,
): Promise<ResolvedPayment> {
  const { data: registration } = await supabaseAdmin
    .from("registrations")
    .select(
      "id, user_id, tournament_id, fee_tier, status, registered_at, confirmed_at, cancelled_at, cancellation_reason, current_payment_id",
    )
    .eq("user_id", userId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (!registration) {
    return { state: "none", registration: null };
  }

  const reg = registration as RegistrationRow;
  const currentPaymentId = (
    registration as { current_payment_id: string | null }
  ).current_payment_id;

  if (reg.status === "confirmed") {
    return { state: "confirmed", registration: reg };
  }
  if (reg.status === "failed_payment") {
    return { state: "failed", registration: reg };
  }
  if (reg.status !== "pending_payment") {
    // cancelled_payment / forfeited — nothing actionable on these pages.
    return { state: "none", registration: reg };
  }

  // Still pending: reconcile the *current* attempt with CHIP so the page is
  // authoritative even if the webhook hasn't arrived.
  const { data: payment } = currentPaymentId
    ? await supabaseAdmin
        .from("payments")
        .select("id, status, chip_transaction_id")
        .eq("id", currentPaymentId)
        .maybeSingle()
    : { data: null };

  if (!payment?.chip_transaction_id) {
    if (isExpired(reg.registered_at)) {
      return expireIfStale(reg);
    }
    return { state: "pending", registration: reg };
  }

  try {
    const purchase = await getChipPurchase(payment.chip_transaction_id);
    const outcome = chipOutcome(purchase.status);
    if (outcome === "pending") {
      // CHIP reconcile ran first, so a late payment was already caught above.
      // Still non-terminal and past the window → expire.
      if (isExpired(reg.registered_at)) {
        return expireIfStale(reg);
      }
      return { state: "pending", registration: reg };
    }

    const { data: settled } = await supabaseAdmin.rpc(
      "settle_registration_payment",
      {
        p_payment_id: payment.id,
        p_paid: outcome === "paid",
        p_amount_cents: purchase.amountCents,
      },
    );

    // The amount CHIP charged didn't match what we recorded — settlement left
    // the payment pending for manual reconciliation, so don't claim success.
    if ((settled as { amount_mismatch?: boolean } | null)?.amount_mismatch) {
      return { state: "pending", registration: reg };
    }

    return {
      state: outcome === "paid" ? "confirmed" : "failed",
      registration: {
        ...reg,
        status: outcome === "paid" ? "confirmed" : "failed_payment",
      },
    };
  } catch {
    // Reconcile failed (CHIP/network) — don't claim success or failure.
    return { state: "pending", registration: reg };
  }
}
