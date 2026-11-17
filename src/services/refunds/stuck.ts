import { supabaseAdmin } from "@/services/supabase/admin";
import { REFUND_STUCK_AFTER_INTERVAL } from "@/lib/refunds/stuck-after";

/**
 * A refund still owed to a player that nothing is moving: never fired, fired
 * at least REFUND_STUCK_AFTER_MINUTES ago and failed or got no answer.
 * One row of list_stuck_refunds.
 */
export interface StuckRefund {
  refund_id: string;
  registration_id: string;
  tournament_id: string;
  tournament_name: string;
  player_name: string | null;
  player_email: string | null;
  amount_cents: number;
  requested_at: string;
  last_fired_at: string | null;
  failed_at: string | null;
  /** NULL when there is no CHIP purchase to refund against: needs a person. */
  original_chip_purchase_id: string | null;
}

/**
 * Every stuck refund across all tournaments, oldest request first. Feeds the
 * admin Stuck refunds page and the count on the admin dashboard.
 */
export async function loadStuckRefunds(): Promise<{
  data: StuckRefund[] | null;
  error: unknown;
}> {
  const { data, error } = await supabaseAdmin.rpc("list_stuck_refunds", {
    p_min_age: REFUND_STUCK_AFTER_INTERVAL,
  });
  if (error) return { data: null, error };
  return { data: (data as StuckRefund[] | null) ?? [], error: null };
}
