import { supabaseAdmin } from "@/services/supabase/admin";

// Prize funding (#523): a sponsor pays into a platform-distributed prize pool
// through CHIP Collect, in a purchase whose `reference` is our prize_fundings id.
// The existing Collect webhook (webhooks/chip/route.ts) settles it here, never
// as a registration.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FindPrizeFundingResult =
  | { id: string | null }
  | { error: { code?: string; message: string } };

/**
 * The prize_fundings row a Collect delivery is about, or null when the purchase
 * isn't a prize funding. Correlates on the CHIP purchase id (stored as
 * chip_transaction_id once checkout was created), then on our `reference`.
 */
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

  // A registration's reference is a payments id; only a uuid that is a
  // prize_fundings id matches here.
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
  /** What CHIP charged, in cents. Guards against a stale or re-priced purchase. */
  amountCents?: number | null;
  paymentMethod?: string | null;
}

export interface SettlePrizeFundingResult {
  error: { code?: string; message: string } | null;
  /** This call booked the contribution (false for a repeat or a failure). */
  newlyPaid: boolean;
  amountMismatch: boolean;
}

/**
 * Settles a sponsor's contribution through settle_prize_funding, which books
 * the type='prize_funding' ledger row once however many times it is called.
 * An amount mismatch is left pending for a person and logged at error level.
 */
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
    };
  }

  const result = data as {
    tournament_id: string;
    newly_paid: boolean;
    amount_mismatch: boolean;
    already_processed: boolean;
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

  return {
    error: null,
    newlyPaid: result.newly_paid,
    amountMismatch: result.amount_mismatch,
  };
}
