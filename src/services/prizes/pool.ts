import { supabaseAdmin } from "@/services/supabase/admin";

// Where a platform-distributed prize pool stands (#523), as prize_pool_position
// (007_payment_functions.sql) computes it. Every surface that shows or checks
// the pool reads it from there rather than re-deriving it.

export interface PrizePoolPosition {
  /** "organizer" (pays its own winners) or "platform" (we distribute). */
  distribution: string;
  /** Total prize money the tournament declares. */
  declared_cents: number;
  /** Paid in by sponsors and cleared. */
  funded_cents: number;
  /** Sent to winners. */
  paid_out_cents: number;
  /** funded - paid out: prize_pool_balance_cents. */
  balance_cents: number;
  /** Committed to approved awards not yet sent. */
  reserved_cents: number;
  /** Entered and awaiting admin review; reserves nothing. */
  pending_review_cents: number;
  /** balance - reserved: what further awards can still be approved for. */
  available_cents: number;
  /** Registration is open only once this is true. Always true for "organizer". */
  fully_funded: boolean;
}

export type PrizePoolResult =
  | { ok: true; position: PrizePoolPosition }
  | { ok: false; error: { code?: string; message: string } };

export async function loadPrizePoolPosition(
  tournamentId: string,
): Promise<PrizePoolResult> {
  const { data, error } = await supabaseAdmin
    .rpc("prize_pool_position", { p_tournament_id: tournamentId })
    .maybeSingle();
  if (error) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  if (!data) {
    return { ok: false, error: { code: "P0002", message: "tournament not found" } };
  }
  return { ok: true, position: data as PrizePoolPosition };
}

/** Declared prize money still to be paid in. Never negative. */
export function unfundedCents(position: PrizePoolPosition): number {
  return Math.max(0, position.declared_cents - position.funded_cents);
}
