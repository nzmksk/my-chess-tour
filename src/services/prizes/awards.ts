import { supabaseAdmin } from "@/services/supabase/admin";
import {
  checkHolderName,
  type HolderNameCheck,
} from "@/services/payouts/holder-name";
import { expectedPlayerHolderName } from "@/services/payouts/player-holder";
import { loadPrizePayees, type PrizePayeeReason } from "./payee";

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
  withdrawn_at: string | null;
  processed_at: string | null;
  payee_user_id: string | null;
  payee_reason: PrizePayeeReason | null;
  winner_bank_status: "pending" | "verified" | "rejected" | "name_mismatch" | null;
  winner_bank_holder_name?: string | null;
  winner_bank_name_check?: HolderNameCheck | null;
}

interface AwardRow extends Omit<
  PrizeAwardView,
  | "tournament_name"
  | "organization_name"
  | "winner_name"
  | "winner_bank_status"
  | "winner_bank_holder_name"
  | "winner_bank_name_check"
> {
  tournament: { name: string | null; organization: { name: string | null } | null } | null;
  winner: { first_name: string | null; last_name: string | null } | null;
}

const COLUMNS = `id, tournament_id, user_id, category, place, amount_cents, settled_amount_cents,
  approval, status, rejection_reason, failure_reason, chip_receipt_url,
  entered_at, reviewed_at, withdrawn_at, processed_at, payee_user_id,
  payee_reason,
  tournament:tournaments(name, organization:organizations!organization_id(name)),
  winner:users!user_id(first_name, last_name)`;

export type AwardsResult =
  | { ok: true; awards: PrizeAwardView[] }
  | { ok: false; error: { code?: string; message: string } };

interface WinnerBank {
  user_id: string;
  status: PrizeAwardView["winner_bank_status"];
  account_holder?: string;
  bank_holder_name?: string | null;
  entered_by?: string | null;
  user?: { first_name: string | null; last_name: string | null } | null;
}

async function toViews(
  rows: AwardRow[],
  { withHolderNames = false }: { withHolderNames?: boolean } = {},
): Promise<AwardsResult> {
  const winnerIds = [
    ...new Set(
      rows
        .filter((r) => !r.payee_user_id)
        .map((r) => r.user_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const payees = await loadPrizePayees(winnerIds);
  if (!payees.ok) return { ok: false, error: payees.error };
  const payeeOf = (r: AwardRow) =>
    r.payee_user_id
      ? { id: r.payee_user_id, reason: r.payee_reason }
      : r.user_id
        ? {
            id: payees.payees.get(r.user_id)?.payeeId ?? r.user_id,
            reason: payees.payees.get(r.user_id)?.reason ?? ("winner" as const),
          }
        : null;

  const userIds = [
    ...new Set(rows.map((r) => payeeOf(r)?.id).filter((id): id is string => !!id)),
  ];
  const banks = new Map<string, WinnerBank>();
  if (userIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("player_bank_accounts")
      .select(
        withHolderNames
          ? "user_id, status, account_holder, bank_holder_name, entered_by, user:users!user_id(first_name, last_name)"
          : "user_id, status",
      )
      .in("user_id", userIds)
      .eq("is_active", true);
    if (error) return { ok: false, error: { code: error.code, message: error.message } };
    for (const b of (data ?? []) as unknown as WinnerBank[]) {
      banks.set(b.user_id, b);
    }
  }

  return {
    ok: true,
    awards: rows.map((row) => {
      const { tournament, winner, ...r } = row;
      const payee = payeeOf(row);
      const bank = payee ? banks.get(payee.id) : undefined;
      return {
        ...r,
        payee_user_id: payee?.id ?? null,
        payee_reason: payee?.reason ?? null,
        tournament_name: tournament?.name ?? null,
        organization_name: tournament?.organization?.name ?? null,
        winner_name:
          [winner?.first_name, winner?.last_name].filter(Boolean).join(" ") || "Deleted account",
        winner_bank_status: bank?.status ?? null,
        ...(withHolderNames && {
          winner_bank_holder_name: bank?.bank_holder_name ?? null,
          winner_bank_name_check: bank
            ? checkHolderName(
                bank.bank_holder_name,
                bank.account_holder === undefined
                  ? null
                  : expectedPlayerHolderName(
                      {
                        account_holder: bank.account_holder,
                        entered_by: bank.entered_by ?? null,
                      },
                      bank.user ?? null,
                    ),
              )
            : null,
        }),
      };
    }),
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
  return toViews([...(open.data ?? []), ...(recent.data ?? [])] as unknown as AwardRow[], {
    withHolderNames: true,
  });
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
