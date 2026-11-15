import { supabaseAdmin } from "@/services/supabase/admin";
import { sendRefundOutcomeEmail } from "@/services/email/email";
import { describePaymentMethod } from "@/services/chip/payment-method-label";

/** The part of settle_refund's result that says whether this call did the work. */
export interface SettleRefundResult {
  newly_settled?: boolean;
  newly_failed?: boolean;
}

interface RefundEmailRow {
  refund_amount_cents: number;
  registration: {
    user: { email: string | null; first_name: string | null } | null;
    tournament: { name: string | null } | null;
    payment: { payment_method: string | null } | null;
  } | null;
}

/**
 * Emails the player how their refund turned out, if settle_refund says this
 * call is the one that settled it (`newly_settled`) or first recorded its
 * failure (`newly_failed`). Every other call (the sync response and the webhook
 * both settling one refund, a redelivered failure) sends nothing, so the player
 * gets one email per outcome.
 *
 * Both settle paths call it: the admin cancellation route on a terminal CHIP
 * response, and the CHIP webhook. Best-effort and never throws: a failed send
 * must not fail the webhook (CHIP would redeliver the whole settle) or the
 * admin's PATCH (the cancellation is already committed).
 */
export async function notifyRefundSettlement(
  refundId: string,
  result: SettleRefundResult | null | undefined,
): Promise<void> {
  const completed = result?.newly_settled === true;
  if (!completed && result?.newly_failed !== true) return;

  try {
    const { data, error } = await supabaseAdmin
      .from("refunds")
      .select(
        `refund_amount_cents,
         registration:registrations!registration_id(
           user:users!user_id(email, first_name),
           tournament:tournaments(name),
           payment:payments!current_payment_id(payment_method)
         )`,
      )
      .eq("id", refundId)
      .single();
    if (error || !data) {
      console.error(
        `Refund ${refundId}: failed to load refund outcome email data`,
        error?.message,
      );
      return;
    }

    const row = data as unknown as RefundEmailRow;
    const email = row.registration?.user?.email;
    if (!email) {
      console.error(`Refund ${refundId}: no player address for the refund outcome email`);
      return;
    }

    await sendRefundOutcomeEmail(email, {
      playerName: row.registration?.user?.first_name ?? "Player",
      tournamentName: row.registration?.tournament?.name ?? "your tournament",
      amountCents: row.refund_amount_cents,
      // The method the player paid with, which is where the refund goes back to.
      paymentMethod: describePaymentMethod(row.registration?.payment?.payment_method),
      completed,
    });
  } catch (err) {
    console.error(
      `Refund ${refundId}: refund outcome email failed`,
      err instanceof Error ? err.message : err,
    );
  }
}
