export interface ChipSendInstructionRequest {
  bank_account_id: number;
  amount: string;
  email: string;
  description: string;
  reference: string;
  send_recipient_receipt?: boolean;
}

export type ChipSendInstructionState =
  | "received"
  | "enquiring"
  | "executing"
  | "reviewing"
  | "accepted"
  | "completed"
  | "rejected"
  | "deleted";

export interface ChipSendInstruction {
  id: number;
  bank_account_id: number;
  amount: string;
  state: ChipSendInstructionState;
  email: string;
  description: string;
  reference: string;
  receipt_url: string;
  slug: string;
  created_at: string;
  updated_at: string;
  send_recipient_receipt: boolean;
}
