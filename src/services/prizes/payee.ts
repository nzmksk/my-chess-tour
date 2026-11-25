import { supabaseAdmin } from "@/services/supabase/admin";

export type PrizePayeeReason = "winner" | "guardian_of_minor";

export interface PrizePayee {
  winnerId: string;
  payeeId: string;
  reason: PrizePayeeReason;
}

interface PayeeRow {
  winner_user_id: string;
  payee_user_id: string;
  reason: PrizePayeeReason;
}

export type PrizePayeesResult =
  | { ok: true; payees: Map<string, PrizePayee> }
  | { ok: false; error: { code?: string; message: string } };

export async function loadPrizePayees(
  winnerIds: string[],
): Promise<PrizePayeesResult> {
  const unique = [...new Set(winnerIds)];
  if (unique.length === 0) return { ok: true, payees: new Map() };

  const { data, error } = await supabaseAdmin.rpc("prize_payees", {
    p_winners: unique,
  });
  if (error) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return {
    ok: true,
    payees: new Map(
      ((data ?? []) as PayeeRow[]).map((r) => [
        r.winner_user_id,
        {
          winnerId: r.winner_user_id,
          payeeId: r.payee_user_id,
          reason: r.reason,
        },
      ]),
    ),
  };
}

export async function minorDependentIds(
  guardianId: string,
): Promise<
  { ok: true; ids: string[] } | { ok: false; error: { message: string } }
> {
  const { data, error } = await supabaseAdmin
    .from("guardianships")
    .select("dependent_user_id")
    .eq("guardian_user_id", guardianId)
    .eq("status", "active")
    .eq("basis", "minor");
  if (error) return { ok: false, error: { message: error.message } };
  return {
    ok: true,
    ids: ((data ?? []) as { dependent_user_id: string }[]).map(
      (r) => r.dependent_user_id,
    ),
  };
}
