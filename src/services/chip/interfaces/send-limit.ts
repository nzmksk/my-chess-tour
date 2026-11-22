import type { ChipSendCurrency, ChipSendFeeType } from "./send-common";

export interface ChipSendLimitRequest {
  amount: number;
}

type ChipSendLimitStatus =
  | "pending"
  | "approved"
  | "expired"
  | "success";

export interface ChipSendLimit {
  id: number;
  currency: ChipSendCurrency;
  fee_type: ChipSendFeeType;
  transaction_type: "in" | "out";
  amount: number;
  fee: number;
  net_amount: number;
  from_settlement: string;
  status: ChipSendLimitStatus;
  expiry_reason: string | null;
  approvals_required: number;
  approvals_received: number;
  created_at: string;
  updated_at: string;
}

export interface ChipSendResendApprovalResponse {
  success: boolean;
  code: number;
  data: Record<string, unknown>;
}
