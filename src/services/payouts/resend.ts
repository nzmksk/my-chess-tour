// When an admin can re-run a payout's send. Pure, so client components can use it.

export interface ResendableState {
  approval: string;
  status: string;
  processed_at: string | null;
  chip_send_instruction_id: number | null;
}

/**
 * True when executePayout would act on the row. That means it is approved, not
 * settled, and either waiting to be sent (`pending`) or claimed by a send that
 * lost track of CHIP's answer (`processing` with no instruction). Nothing else
 * retries these rows yet, and a re-run is always safe: CHIP dedupes on the
 * reference, and settle_payout no-ops on a settled row.
 */
export function canResend(p: ResendableState): boolean {
  if (p.approval !== "approved" || p.processed_at !== null) return false;
  if (p.status === "pending") return true;
  return p.status === "processing" && p.chip_send_instruction_id === null;
}
