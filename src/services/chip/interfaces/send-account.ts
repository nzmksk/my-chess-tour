import type { ChipSendCurrency, ChipSendFeeType } from "./send-common";

export interface ChipSendAccount {
  id: number;
  status: "active" | "pending";
  currency: ChipSendCurrency;
  settlement_convert_approvals_count: number;
  send_fee: number;
  send_fee_type: ChipSendFeeType;
  account_verification_fee: number;
  account_verification_fee_type: ChipSendFeeType;
  convertible_balance_from_statement: number;
  current_balance: number;
  created_at: string;
  updated_at: string;
}
