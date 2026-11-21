export interface ResendableState {
  approval: string;
  status: string;
  processed_at: string | null;
  chip_send_instruction_id: number | null;
}

export function canResend(p: ResendableState): boolean {
  if (p.approval !== "approved" || p.processed_at !== null) return false;
  if (p.status === "pending") return true;
  return p.status === "processing" && p.chip_send_instruction_id === null;
}
