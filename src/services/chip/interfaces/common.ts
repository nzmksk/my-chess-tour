export interface Client {
  email: string;
  bank_account?: string;
  bank_code?: string;
  phone?: string;
  full_name?: string;
  personal_code?: string;
  street_address?: string;
  country?: string;
  city?: string;
  zip_code?: string;
  state?: string;
  shipping_street_address?: string;
  shipping_country?: string;
  shipping_city?: string;
  shipping_zip_code?: string;
  shipping_state?: string;
  cc?: string[];
  bcc?: string[];
  legal_name?: string;
  brand_name?: string;
  registration_number?: string;
  tax_number?: string;
}

export interface Product {
  name: string;
  price: number;
  quantity?: string;
  discount?: number;
  tax_percent?: string;
  category?: string;
  total_price_override?: number | null;
}

export type ClientDetails =
  | "email"
  | "phone"
  | "full_name"
  | "personal_code"
  | "brand_name"
  | "legal_name"
  | "registration_number"
  | "tax_number"
  | "bank_account"
  | "bank_code"
  | "billing_address"
  | "shipping_address";

export type PaymentMethod =
  | "fpx"
  | "fpx_b2b1"
  | "crypto_coin"
  | "dnqr"
  | "duitnow_qr"
  | "maestro"
  | "mastercard"
  | "mpgs_apple_pay"
  | "mpgs_google_pay"
  | "razer_atome"
  | "razer_grabpay"
  | "razer_maybankqr"
  | "razer_shopeepay"
  | "razer_tng"
  | "shopee_pay"
  | "visa";

export type Platform = "web" | "api" | "ios" | "android" | "macos" | "windows";

type PaymentType =
  | "purchase"
  | "purchase_charge"
  | "payout"
  | "bank_payment"
  | "refund"
  | "custom";

export interface Payment {
  is_outgoing: boolean;
  payment_type: PaymentType;
  amount: number;
  currency: string;
  net_amount: number;
  fee_amount: number;
  pending_amount: number;
  pending_unfreeze_on: number | null;
  description: string;
  paid_on: number;
  remote_paid_on: number;
}

export interface RelatedObject {
  type: string;
  id: string;
}

type Flow =
  | "api"
  | "direct_post"
  | "fluentforms"
  | "formidableforms"
  | "givewp"
  | "gravityforms"
  | "hostbill"
  | "import"
  | "link"
  | "magento"
  | "opencart"
  | "payform"
  | "paymattic"
  | "prestashop"
  | "server_to_server"
  | "shopify"
  | "web_office"
  | "whmcs"
  | "woocommerce"
  | "wpcharitable";

interface Extra {
  masked_pan: string;
  three_d_secure: boolean;
  expiry_month: number;
  expiry_year: number;
  cardholder_name: string;
}

type ErrorCode =
  | "unknown_payment_method"
  | "invalid_card_number"
  | "invalid_expires"
  | "no_matching_terminal"
  | "blacklisted_tx"
  | "timeout_3ds_enrollment_check"
  | "timeout_acquirer_status_check"
  | "validation_card_details_missing"
  | "validation_cvc_not_provided"
  | "validation_cardholder_name_not_provided"
  | "validation_card_number_not_provided"
  | "validation_expires_not_provided"
  | "validation_cvc_too_long"
  | "validation_cardholder_name_too_long"
  | "validation_card_number_too_long"
  | "validation_expires_too_long"
  | "validation_cvc_invalid"
  | "validation_cardholder_name_invalid"
  | "validation_card_number_invalid"
  | "validation_expires_invalid"
  | "acquirer_connection_error"
  | "blacklisted_tx_issuing_country"
  | "s2s_not_supported"
  | "timeout"
  | "general_transaction_error"
  | "antifraud_general"
  | "acquirer_internal_error"
  | "exceeds_frequency_limit"
  | "insufficient_funds"
  | "purchase_already_paid_for"
  | "issuer_not_available"
  | "3ds_authentication_failed"
  | "do_not_honour"
  | "exceeds_withdrawal_limit"
  | "exceeded_account_limit"
  | "expired_card"
  | "blacklisted_tx_risk_score"
  | "transaction_not_supported_or_not_valid_for_card"
  | "exceeded_acquirer_refund_amount"
  | "transaction_not_permitted_on_terminal"
  | "acquirer_configuration_error"
  | "transaction_not_permitted_to_cardholder"
  | "invalid_issuer_number"
  | "restricted_card"
  | "merchant_response_timeout"
  | "reconcile_error"
  | "lost_card"
  | "stolen_card"
  | "invalid_amount"
  | "re_enter_transaction"
  | "security_violation"
  | "partial_forbidden"
  | "suspected_fraud"
  | "acquirer_routing_error"
  | "payment_rejected_other_reason"
  | "authorization_failed"
  | "acquirer_error_cs"
  | "decline_irregular_transaction_pattern"
  | "invalid_card_data"
  | "exceeded_terminal_limit"
  | "recurring_token_expired"
  | "soft_decline_contact_support"
  | "payment_method_details_missing";

interface AttemptError {
  code: ErrorCode;
  message: string;
}

type AttemptType =
  | "execute"
  | "authorize"
  | "release"
  | "capture"
  | "recurring_execute"
  | "delete_recurring_token"
  | "refund";

interface Attempt {
  type: AttemptType;
  successful: boolean;
  payment_method: PaymentMethod;
  extra: Extra;
  country: string;
  client_ip: string;
  processing_time: number;
  error: AttemptError;
}

export interface TransactionData {
  payment_method: PaymentMethod;
  flow: Flow;
  processing_tx_id: string;
  extra: Extra;
  country: string;
  attempts: Attempt[];
}
