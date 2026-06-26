import { supabaseAdmin } from "@/services/supabase/admin";
import { chipOutcome, getChipPurchase } from "@/services/chip/chip";
import type { RegistrationRow } from "../types";

export type PaymentState = "confirmed" | "pending" | "failed" | "none";

export interface ResolvedPayment {
  state: PaymentState;
  registration: RegistrationRow | null;
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
      "id, user_id, tournament_id, fee_tier, status, registered_at, confirmed_at, cancelled_at, cancellation_reason",
    )
    .eq("user_id", userId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (!registration) {
    return { state: "none", registration: null };
  }

  const reg = registration as RegistrationRow;

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

  // Still pending: try to reconcile with CHIP so the page is authoritative even
  // if the webhook hasn't arrived (or isn't configured for this event).
  const { data: payment } = await supabaseAdmin
    .from("payments")
    .select("id, status, chip_transaction_id")
    .eq("registration_id", reg.id)
    .eq("type", "registration")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!payment?.chip_transaction_id) {
    return { state: "pending", registration: reg };
  }

  try {
    const purchase = await getChipPurchase(payment.chip_transaction_id);
    const outcome = chipOutcome(purchase.status);
    if (outcome === "pending") {
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
