export interface EntryFeeBreakdown {
  entry_cents: number;
  processing_fee_cents: number;
  gross_cents: number;
}

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
