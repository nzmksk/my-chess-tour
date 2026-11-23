import { supabaseAdmin } from "@/services/supabase/admin";
import { sendRefundOutcomeEmail } from "@/services/email/email";
import { describePaymentMethod } from "@/services/chip/payment-method-label";

export interface SettleRefundResult {
  newly_settled?: boolean;
  newly_failed?: boolean;
}

interface RefundEmailRow {
  refund_amount_cents: number;
  registration: {
    tournament: { name: string | null } | null;
    payment: {
      payment_method: string | null;
      payer: { email: string | null; first_name: string | null } | null;
    } | null;
  } | null;
}

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
           tournament:tournaments(name),
           payment:payments!current_payment_id(
             payment_method,
             payer:users!user_id(email, first_name)
           )
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
    const payer = row.registration?.payment?.payer;
    const email = payer?.email;
    if (!email) {
      console.error(`Refund ${refundId}: no payer address for the refund outcome email`);
      return;
    }

    await sendRefundOutcomeEmail(email, {
      playerName: payer?.first_name ?? "Player",
      tournamentName: row.registration?.tournament?.name ?? "your tournament",
      amountCents: row.refund_amount_cents,
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
