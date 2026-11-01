import type { ChipSendCurrency, ChipSendFeeType } from "./send-common";

/**
 * Body of `POST /send/send_limits` (increase budget allocation).
 *
 * ⚠️ LANDMINE: `amount` is a JSON **number** here, whereas a send
 * instruction's `amount` is a **string**. Mixing them up is rejected by CHIP.
 * Build this through `increaseChipSendLimit`, which takes cents and does the
 * conversion — never construct it by hand.
 */
export interface ChipSendLimitRequest {
  amount: number;
}

export type ChipSendLimitStatus = "pending" | "approved" | "expired";

/** A send-limit (budget allocation) record. */
export interface ChipSendLimit {
  id: number;
  currency: ChipSendCurrency;
  fee_type: ChipSendFeeType;
  transaction_type: "in" | "out";
  /** JSON number — see the landmine on `ChipSendLimitRequest`. */
  amount: number;
  fee: number;
  net_amount: number;
  from_settlement: string;
  /**
   * Stays `pending` until every approver clicks Approve in their email.
   * Requests not approved by 12 PM MYT the next day become `expired`.
   */
  status: ChipSendLimitStatus;
  approvals_required: number;
  approvals_received: number;
  created_at: string;
  updated_at: string;
}

/** Body of `POST /send/send_limits/{id}/resend_approval_requests`. */
export interface ChipSendResendApprovalResponse {
  success: boolean;
  code: number;
  data: Record<string, unknown>;
}
