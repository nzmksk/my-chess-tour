import { supabaseAdmin } from "@/services/supabase/admin";

export type PaidRegistrationResult =
  | { ok: true; paid: boolean }
  | { ok: false; error: unknown };

export async function hasPaidRegistration(
  tournamentId: string,
): Promise<PaidRegistrationResult> {
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
