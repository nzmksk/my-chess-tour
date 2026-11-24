import { supabaseAdmin } from "@/services/supabase/admin";
import { sendRefundOutcomeEmail } from "@/services/email/email";
import { describePaymentMethod } from "@/services/chip/payment-method-label";
import { fullName } from "@/services/email/participant-recipients";

export interface SettleRefundResult {
  newly_settled?: boolean;
  newly_failed?: boolean;
}

interface RefundEmailRow {
  refund_amount_cents: number;
  registration: {
    user_id: string | null;
    participant: { first_name: string | null; last_name: string | null } | null;
    tournament: { name: string | null } | null;
    payment: {
      payment_method: string | null;
      user_id: string | null;
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
           user_id,
           participant:users!user_id(first_name, last_name),
           tournament:tournaments(name),
           payment:payments!current_payment_id(
             payment_method,
             user_id,
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

    const registration = row.registration;
    const paidForSomeoneElse =
      registration?.payment?.user_id != null &&
      registration.payment.user_id !== registration.user_id;

    await sendRefundOutcomeEmail(email, {
      recipientName: payer?.first_name ?? "Player",
      aboutPlayer: paidForSomeoneElse ? fullName(registration.participant) : null,
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
