import { supabaseAdmin } from "@/services/supabase/admin";

export interface PrizePoolPosition {
  distribution: string;
  declared_cents: number;
  funded_cents: number;
  paid_out_cents: number;
  balance_cents: number;
  reserved_cents: number;
  pending_review_cents: number;
  available_cents: number;
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
