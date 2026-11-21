import type { Client, Payment, RelatedObject, TransactionData } from "./common";
import type { PurchasesResponse } from "./purchases-response";

interface RefundPayment {
  type: string;
  id: string;
  created_on: number;
  updated_on: number;
  client: Client;
  payment: Payment;
  transaction_data: TransactionData;
  related_to: RelatedObject | null;
  reference_generated: string;
  reference: string;
  account_id: string;
  company_id: string;
  is_test: boolean;
  user_id: string | null;
  brand_id: string;
}

export type RefundResponse = RefundPayment | PurchasesResponse;

export function isPendingRefund(
  response: RefundResponse,
): response is PurchasesResponse {
  return "status" in response;
}
