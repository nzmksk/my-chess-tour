import { supabaseAdmin } from "@/services/supabase/admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FindPrizeFundingResult =
  | { id: string | null }
  | { error: { code?: string; message: string } };

export async function findPrizeFundingForPurchase(
  purchaseId: string | null | undefined,
  reference: string | null | undefined,
): Promise<FindPrizeFundingResult> {
  if (purchaseId) {
    const { data, error } = await supabaseAdmin
      .from("prize_fundings")
      .select("id")
      .eq("chip_transaction_id", purchaseId)
      .maybeSingle();
    if (error) return { error: { code: error.code, message: error.message } };
    const id = (data as { id: string } | null)?.id ?? null;
    if (id) return { id };
  }

  if (reference && UUID_RE.test(reference)) {
    const { data, error } = await supabaseAdmin
      .from("prize_fundings")
      .select("id")
      .eq("id", reference)
      .maybeSingle();
    if (error) return { error: { code: error.code, message: error.message } };
    return { id: (data as { id: string } | null)?.id ?? null };
  }

  return { id: null };
}

export interface SettlePrizeFundingInput {
  fundingId: string;
  paid: boolean;
  amountCents?: number | null;
  paymentMethod?: string | null;
}

export interface SettlePrizeFundingResult {
  error: { code?: string; message: string } | null;
  newlyPaid: boolean;
  amountMismatch: boolean;
  wentLive: boolean;
  tournamentId: string | null;
}

export async function settlePrizeFunding(
  input: SettlePrizeFundingInput,
): Promise<SettlePrizeFundingResult> {
  const { data, error } = await supabaseAdmin.rpc("settle_prize_funding", {
    p_funding_id: input.fundingId,
    p_paid: input.paid,
    p_amount_cents: input.amountCents ?? null,
    p_payment_method: input.paymentMethod ?? null,
  });

  if (error) {
    return {
      error: { code: error.code, message: error.message },
      newlyPaid: false,
      amountMismatch: false,
      wentLive: false,
      tournamentId: null,
    };
  }

  const result = data as {
    tournament_id: string;
    newly_paid: boolean;
    amount_mismatch: boolean;
    already_processed: boolean;
    went_live?: boolean;
  };

  if (result.amount_mismatch) {
    console.error(
      `Prize funding ${input.fundingId}: paid ${input.amountCents ?? "an unknown amount"} cents, which isn't what the funder was asked for; left pending for manual reconciliation`,
    );
  } else if (result.newly_paid) {
    console.info(
      `Prize funding ${input.fundingId}: paid into the pool of tournament ${result.tournament_id}`,
    );
  } else if (!input.paid && !result.already_processed) {
    console.warn(`Prize funding ${input.fundingId}: the funder's payment failed`);
  }

  if (result.went_live) {
    console.info(
      `Prize funding ${input.fundingId}: the pool is complete, so tournament ${result.tournament_id} is now listed`,
    );
  }

  return {
    error: null,
    newlyPaid: result.newly_paid,
    amountMismatch: result.amount_mismatch,
    wentLive: result.went_live === true,
    tournamentId: result.tournament_id ?? null,
  };
}
