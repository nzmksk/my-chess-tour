import { supabaseAdmin } from "@/services/supabase/admin";

export type PaidRegistrationResult =
  | { ok: true; paid: boolean }
  | { ok: false; error: unknown };

/**
 * Whether any registration payment for this tournament has settled. This is
 * what puts a tournament in the edit policy's "paid" stage
 * (src/lib/tournaments/edit-policy.ts).
 *
 * The test is the one guard_tournament_paid_fields uses: a `payments` row with
 * type 'registration' and status 'paid'. Not the confirmed-registration count:
 * a paid registration that is later forfeited (after a refund, say) leaves its
 * payment row 'paid', since refunds are separate rows, so the fields stay
 * locked. Everything that asks "has anyone paid?" for editing calls this, so
 * the wizard and the API can't disagree.
 */
export async function hasPaidRegistration(
  tournamentId: string,
): Promise<PaidRegistrationResult> {
  // `head: true`: only whether one exists matters.
  const { count, error } = await supabaseAdmin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("type", "registration")
    .eq("status", "paid")
    .limit(1);

  if (error) return { ok: false, error };
  return { ok: true, paid: (count ?? 0) > 0 };
}
