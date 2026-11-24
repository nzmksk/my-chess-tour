import { supabaseAdmin } from "@/services/supabase/admin";
import { sendRegistrationConfirmationEmail } from "@/services/email/email";
import { formatCalendarDateRange, resolveTimeZone } from "@/lib/tournaments/datetime";

interface ConfirmedRegistrationRow {
  status: string;
  user: { email: string | null; first_name: string | null } | null;
  tournament: {
    name: string | null;
    slug: string | null;
    start_date: string;
    end_date: string;
    timezone: string | null;
    venue_name: string | null;
    venue_state: string | null;
  } | null;
  payment: { gross_amount_cents: number } | null;
}

export async function notifyRegistrationConfirmed(registrationId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("registrations")
      .select(
        `status,
         user:users!user_id(email, first_name),
         tournament:tournaments(name, slug, start_date, end_date, timezone, venue_name, venue_state),
         payment:payments!current_payment_id(gross_amount_cents)`,
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
    const email = reg.user?.email;
    if (!email || !reg.tournament) {
      console.error(
        `Registration ${registrationId}: no player address or tournament for the confirmation email`,
      );
      return;
    }

    const t = reg.tournament;
    await sendRegistrationConfirmationEmail(email, {
      recipientName: reg.user?.first_name ?? "Player",
      tournamentName: t.name ?? "your tournament",
      tournamentSlug: t.slug,
      tournamentDates: formatCalendarDateRange(
        t.start_date,
        t.end_date,
        resolveTimeZone(t.timezone),
      ),
      venue: [t.venue_name, t.venue_state].filter(Boolean).join(", "),
      feePaidCents: reg.payment?.gross_amount_cents ?? 0,
    });
  } catch (err) {
    console.error(
      `Registration ${registrationId}: confirmation email failed`,
      err instanceof Error ? err.message : err,
    );
  }
}
