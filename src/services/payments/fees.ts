export interface EntryFeeBreakdown {
  /** The organizer's entry fee for the tier. */
  entry_cents: number;
  /** The player's share of the platform commission, added on top of the entry fee. */
  processing_fee_cents: number;
  /** The total the player is charged (entry + processing fee). */
  gross_cents: number;
}

/**
 * Computes what a player is charged for a registration tier.
 *
 * SOURCE OF TRUTH: this mirrors the SQL in `create_registration_with_payment`
 * (db/migrations/003_functions_triggers.sql) — keep the two in sync (covered by
 * fees.test.ts). The DB function remains authoritative for the actual charge;
 * this is used to display the same number before the purchase is created.
 *
 *   platform_fee         = floor(entry * commission_rate / 100)
 *   organizer_commission = floor(platform_fee * organizer_commission_pct / 10)
 *   player_commission    = platform_fee - organizer_commission
 *   gross                = entry + player_commission   (what the player pays)
 */
export function computeEntryFeeBreakdown(
  entryCents: number,
  commissionRate: number,
  organizerCommissionPct: number,
): EntryFeeBreakdown {
  const platformFee = Math.floor((entryCents * commissionRate) / 100);
  const organizerCommission = Math.floor(
    (platformFee * organizerCommissionPct) / 10,
  );
  const playerCommission = platformFee - organizerCommission;
  return {
    entry_cents: entryCents,
    processing_fee_cents: playerCommission,
    gross_cents: entryCents + playerCommission,
  };
}
