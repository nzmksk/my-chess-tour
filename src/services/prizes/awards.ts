import { supabaseAdmin } from "@/services/supabase/admin";

export interface PrizeAwardView {
  id: string;
  tournament_id: string;
  tournament_name: string | null;
  organization_name: string | null;
  user_id: string | null;
  winner_name: string;
  category: string;
  place: string | null;
  amount_cents: number;
  settled_amount_cents: number | null;
  approval: "pending" | "approved" | "rejected";
  status: "pending" | "processing" | "paid" | "failed";
  rejection_reason: string | null;
  failure_reason: string | null;
  chip_receipt_url: string | null;
  entered_at: string;
  reviewed_at: string | null;
  processed_at: string | null;
  winner_bank_status: "pending" | "verified" | "rejected" | null;
}

interface AwardRow extends Omit<
  PrizeAwardView,
  "tournament_name" | "organization_name" | "winner_name" | "winner_bank_status"
> {
  tournament: { name: string | null; organization: { name: string | null } | null } | null;
  winner: { first_name: string | null; last_name: string | null } | null;
}

const COLUMNS = `id, tournament_id, user_id, category, place, amount_cents, settled_amount_cents,
  approval, status, rejection_reason, failure_reason, chip_receipt_url,
  entered_at, reviewed_at, processed_at,
  tournament:tournaments(name, organization:organizations!organization_id(name)),
  winner:users!user_id(first_name, last_name)`;

export type AwardsResult =
  | { ok: true; awards: PrizeAwardView[] }
  | { ok: false; error: { code?: string; message: string } };

async function toViews(rows: AwardRow[]): Promise<AwardsResult> {
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id))];
  const bankStatus = new Map<string, PrizeAwardView["winner_bank_status"]>();
  if (userIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("player_bank_accounts")
      .select("user_id, status")
      .in("user_id", userIds)
      .eq("is_active", true);
    if (error) return { ok: false, error: { code: error.code, message: error.message } };
    for (const b of (data ?? []) as { user_id: string; status: PrizeAwardView["winner_bank_status"] }[]) {
      bankStatus.set(b.user_id, b.status);
    }
  }

  return {
    ok: true,
    awards: rows.map(({ tournament, winner, ...r }) => ({
      ...r,
      tournament_name: tournament?.name ?? null,
      organization_name: tournament?.organization?.name ?? null,
      winner_name:
        [winner?.first_name, winner?.last_name].filter(Boolean).join(" ") || "Deleted account",
      winner_bank_status: r.user_id ? (bankStatus.get(r.user_id) ?? null) : null,
    })),
  };
}

export async function listTournamentAwards(tournamentId: string): Promise<AwardsResult> {
  const { data, error } = await supabaseAdmin
    .from("prize_awards")
    .select(COLUMNS)
    .eq("tournament_id", tournamentId)
    .order("entered_at", { ascending: false });
  if (error) return { ok: false, error: { code: error.code, message: error.message } };
  return toViews((data ?? []) as unknown as AwardRow[]);
}

export async function listAdminAwards(): Promise<AwardsResult> {
  const [open, recent] = await Promise.all([
    supabaseAdmin
      .from("prize_awards")
      .select(COLUMNS)
      .neq("approval", "rejected")
      .is("processed_at", null)
      .order("entered_at", { ascending: true }),
    supabaseAdmin
      .from("prize_awards")
      .select(COLUMNS)
      .or("processed_at.not.is.null,approval.eq.rejected")
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);
  const error = open.error ?? recent.error;
  if (error) return { ok: false, error: { code: error.code, message: error.message } };
  return toViews([...(open.data ?? []), ...(recent.data ?? [])] as unknown as AwardRow[]);
}

export function canRetryAward(award: {
  approval: string;
  status: string;
  processed_at: string | null;
  chip_send_instruction_id?: number | null;
}): boolean {
  return (
    award.approval === "approved" &&
    !award.processed_at &&
    (award.status === "pending" ||
      (award.status === "processing" && !award.chip_send_instruction_id))
  );
}
