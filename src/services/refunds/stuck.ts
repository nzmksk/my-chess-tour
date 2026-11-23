import { supabaseAdmin } from "@/services/supabase/admin";
import { REFUND_STUCK_AFTER_INTERVAL } from "@/lib/refunds/stuck-after";

export interface StuckRefund {
  refund_id: string;
  registration_id: string;
  tournament_id: string;
  tournament_name: string;
  payer_name: string | null;
  payer_email: string | null;
  amount_cents: number;
  requested_at: string;
  last_fired_at: string | null;
  failed_at: string | null;
  original_chip_purchase_id: string | null;
}

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
