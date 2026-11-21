import type {
  Client,
  ClientDetails,
  Payment,
  PaymentMethod,
  Platform,
  Product,
  RelatedObject,
  TransactionData
} from "./common";

interface Purchase {
  products: Product[];
  currency: string;
  total: number;
  language: string;
  notes: string;
  debt: number;
  subtotal_override: number | null;
  total_tax_override: number | null;
  total_discount_override: number | null;
  total_override: number;
  request_client_details: ClientDetails[];
  timezone: string;
  due_strict: boolean;
  email_message: string;
  shipping_options: object[];
  payment_method_details: object;
  has_upsell_products: boolean;
  single_attempt: boolean;
  metadata: object;
}

interface BankAccount {
  bank_account: string;
  bank_code: string;
}

interface IssuerDetails {
  website: string;
  legal_street_address: string;
  legal_country: string;
  legal_city: string;
  legal_zip_code: string;
  bank_accounts: BankAccount[];
  legal_name: string;
  brand_name: string;
  registration_number: string;
  tax_number: string;
}






type PurchaseStatus =
  | "created"
  | "sent"
  | "viewed"
  | "error"
  | "cancelled"
  | "overdue"
  | "expired"
  | "blocked"
  | "hold"
  | "released"
  | "pending_release"
  | "pending_capture"
  | "preauthorized"
  | "paid"
  | "pending_execute"
  | "pending_charge"
  | "cleared"
  | "settled"
  | "chargeback"
  | "pending_refund"
  | "refunded";

interface PurchaseStatusHistory {
  status: PurchaseStatus;
  timestamp: number;
  related_object: RelatedObject | null;
}

type RefundAvailability =
  | "all"
  | "full_only"
  | "partial_only"
  | "pis_all"
  | "pis_partial"
  | "none";

interface CurrencyConversion {
  original_currency: string;
  original_amount: number;
  exchange_rate: number;
}

type GatewayProduct = "purchases";

export interface PurchasesResponse {
  client: Client;
  purchase: Purchase;
  brand_id: string;
  type: string;
  id: string;
  created_at: number;
  updated_on: number;
  payment: Payment | null;
  issuer_details: IssuerDetails;
  transaction_data: TransactionData;
  status: PurchaseStatus;
  status_history: PurchaseStatusHistory[];
  viewed_on: number;
  company_id: string;
  is_test: boolean;
  user_id: string | null;
  client_id: string | null;
  send_receipt: boolean;
  is_recurring_token: boolean;
  recurring_token: string | null;
  skip_capture: boolean;
  force_recurring: boolean;
  reference_generated: string;
  reference: string;
  notes: string;
  issued: string | null;
  due: number | null;
  refund_availability: RefundAvailability;
  refundable_amount: number;
  currency_conversion: CurrencyConversion | null;
  payment_method_whitelist: PaymentMethod[];
  success_redirect: string;
  failure_redirect: string;
  cancel_redirect: string;
  success_callback: string;
  creator_agent: string;
  platform: Platform;
  product: GatewayProduct;
  created_from_ip: string;
  invoice_url: string | null;
  checkout_url: string;
  direct_post_url: string | null;
  marked_as_paid: boolean;
  order_id: string;
  upsell_campaigns: object;
  referral_campaign_id: string | null;
  referral_code: string | null;
  referral_code_details: object | null;
  referral_code_generated: object | null;
  retain_level_details: object | null;
  can_retrieve: boolean;
  can_chargeback: boolean;
  can_reverse_chargeback: boolean;
  tags?: string[];
}
