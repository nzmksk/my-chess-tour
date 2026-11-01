import type { ChipSendCurrency, ChipSendFeeType } from "./send-common";

/**
 * A CHIP Send account (`GET /send/accounts` → `results[]`). One per currency;
 * in practice a single MYR account.
 *
 * The money fields here are JSON **numbers in ringgit** ("1 for RM 1" per the
 * spec), not cents.
 */
export interface ChipSendAccount {
  id: number;
  status: "active" | "pending";
  currency: ChipSendCurrency;
  /** Approvals required before a budget allocation (send limit) takes effect. */
  settlement_convert_approvals_count: number;
  send_fee: number;
  send_fee_type: ChipSendFeeType;
  account_verification_fee: number;
  account_verification_fee_type: ChipSendFeeType;
  /**
   * Settlement balance that can still be converted into send budget. Reset
   * daily to a virtual RM 1,000 in staging; real-time in production.
   */
  convertible_balance_from_statement: number;
  /** Budget available for send instructions right now. */
  current_balance: number;
  created_at: string;
  updated_at: string;
}
