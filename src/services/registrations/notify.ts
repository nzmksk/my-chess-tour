import { supabaseAdmin } from "@/services/supabase/admin";
import { sendRegistrationConfirmationEmail } from "@/services/email/email";
import { addRecipient, sendToAll } from "@/services/email/recipients";
import {
  loadParticipantRecipients,
  nameForRecipient,
} from "@/services/email/participant-recipients";
import { formatCalendarDateRange, resolveTimeZone } from "@/lib/tournaments/datetime";

interface ConfirmedRegistrationRow {
  status: string;
  user_id: string | null;
  tournament: {
    name: string | null;
    slug: string | null;
    start_date: string;
    end_date: string;
    timezone: string | null;
    venue_name: string | null;
    venue_state: string | null;
  } | null;
  payment: {
    gross_amount_cents: number;
    payer: { email: string | null; first_name: string | null } | null;
  } | null;
}

export async function notifyRegistrationConfirmed(registrationId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("registrations")
      .select(
        `status, user_id,
         tournament:tournaments(name, slug, start_date, end_date, timezone, venue_name, venue_state),
         payment:payments!current_payment_id(gross_amount_cents, payer:users!user_id(email, first_name))`,
      )
      .eq("id", registrationId)
      .single();
    if (error || !data) {
      console.error(
        `Registration ${registrationId}: failed to load confirmation email data`,
        error?.message,
      );
      return;
    }
    const reg = data as unknown as ConfirmedRegistrationRow;
    if (reg.status !== "confirmed") {
      console.error(
        `Registration ${registrationId}: confirmation email requested for status ${reg.status}`,
      );
      return;
    }
    if (!reg.user_id || !reg.tournament) {
      console.error(
        `Registration ${registrationId}: no participant or tournament for the confirmation email`,
      );
      return;
    }

    const contacts = await loadParticipantRecipients(reg.user_id);
    if (!contacts) return;
    addRecipient(contacts.recipients, reg.payment?.payer?.email, reg.payment?.payer?.first_name);
    if (contacts.recipients.size === 0) {
      console.error(
        `Registration ${registrationId}: no player, guardian or payer address for the confirmation email`,
      );
      return;
    }

    const t = reg.tournament;
    const details = {
      tournamentName: t.name ?? "your tournament",
      tournamentSlug: t.slug,
      tournamentDates: formatCalendarDateRange(
        t.start_date,
        t.end_date,
        resolveTimeZone(t.timezone),
      ),
      venue: [t.venue_name, t.venue_state].filter(Boolean).join(", "),
      feePaidCents: reg.payment?.gross_amount_cents ?? 0,
    };
    await sendToAll(
      contacts.recipients,
      (r) =>
        sendRegistrationConfirmationEmail(r.email, {
          ...details,
          recipientName: r.name,
          aboutPlayer: nameForRecipient(contacts, r),
        }),
      `confirmation email(s) for registration ${registrationId}`,
    );
  } catch (err) {
    console.error(
      `Registration ${registrationId}: confirmation email failed`,
      err instanceof Error ? err.message : err,
    );
  }
}
