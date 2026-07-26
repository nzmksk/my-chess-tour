// Types shared verbatim by the CHIP purchase request and response payloads.
// `Purchase` deliberately lives in each file instead: the response variant carries
// server-computed fields (`total`) and returns every field populated, while the
// request variant is almost entirely optional.

export interface Client {
  /** Email address */
  email: string;
  /** Bank account number */
  bank_account?: string;
  /** SWIFT/BIC code of the bank */
  bank_code?: string;
  /**
   * Phone number in the <country_code><number> format
   * @example +15551234567
   */
  phone?: string;
  /** Name and surname of client. It is advisable to include `full_name` in request body. */
  full_name?: string;
  /** Personal identification code of client */
  personal_code?: string;
  /** Street house number and flat address where applicable */
  street_address?: string;
  /**
   * Country code in the ISO 3166-1 alpha-2 format
   * @example "US"
   */
  country?: string;
  /** City name */
  city?: string;
  /** ZIP or postal code */
  zip_code?: string;
  /** State or province name */
  state?: string;
  /** Street house number and flat address where applicable for shipping */
  shipping_street_address?: string;
  /**
   * Country code in the ISO 3166-1 alpha-2 format, e.g. "US" for shipping
   * @example "US"
   */
  shipping_country?: string;
  /** City name for shipping */
  shipping_city?: string;
  /** ZIP or postal code for shipping */
  shipping_zip_code?: string;
  /** State or province name for shipping */
  shipping_state?: string;
  /** Email addresses to receive a carbon copy of all notification emails */
  cc?: string[];
  /** Email addresses to receive a blind carbon copy of all notification emails */
  bcc?: string[];
  /** Legal name of company */
  legal_name?: string;
  /** Brand name of company */
  brand_name?: string;
  /** Registration number of company */
  registration_number?: string;
  /** Tax payer registration number */
  tax_number?: string;
}

export interface Product {
  /** Product name */
  name: string;
  /**
   * Use this field or `total_override` with a value of 0 to activate the preauthorization scenario. See `skip_capture` field.
   *
   * This field is an integer, and the value should be in cents. For example, 1000 means RM10.00.
   */
  price: number;
  /**
   * Quantity of these products in invoice
   * @default "1"
   */
  quantity?: string;
  /**
   * Total discount per this product in invoice
   * @default 0
   */
  discount?: number;
  /**
   * Percent of tax added to the price of this product
   * @default "0"
   */
  tax_percent?: string;
  /** Product category */
  category?: string;
  /** If specified and not null, will override the total price for this product */
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

export type PaymentType =
  | "purchase"
  | "purchase_charge"
  | "payout"
  | "bank_payment"
  | "refund"
  | "custom";

/**
 * Details of an executed transaction. Read-only.
 *
 * Appears as `payment` on a Purchase (null until it is paid) and on a refund
 * Payment object, where `payment_type` is `refund` and `is_outgoing` is `true`.
 */
export interface Payment {
  /**
   * Denotes the direction of payment, e.g. for a paid Purchase, is granted to be `false`, `true` for payouts.
   * @default false
   */
  is_outgoing: boolean;
  payment_type: PaymentType;
  /** Amount of money in smallest currency units */
  amount: number;
  /**
   * Currency code in the ISO 4217 standard.
   * @example "EUR"
   */
  currency: string;
  /**
   * Net amount of payment with all fees and pending amount subtracted.
   * `amount` = `net_amount` + `fee_amount` + `pending_amount`.
   * The respective account is credited or debited with this value.
   */
  net_amount: number;
  /**
   * Amount of fees for this payment.
   * For a Purchase's PurchaseDetails this is the calculated transaction fee.
   */
  fee_amount: number;
  /**
   * Pending amount for this payment that will be unfrozen later.
   * If e.g. it's a Purchase's PaymentDetails and a part of transaction sum is withheld
   * to form a rolling reserve, this field will be equal to the frozen part amount.
   */
  pending_amount: number;
  /** Informs when the `pending_amount` will be unfrozen. */
  pending_unfreeze_on: number | null;
  /** Payment description */
  description: string;
  /** When the payment was accepted in (`is_outgoing == false`) or sent from (`is_outgoing == true`) the gateway system. */
  paid_on: number;
  /**
   * If available, this field will report the date the payment was sent by the remote payer (`is_outgoing == false`)
   * or when funds arrived to the remote beneficiary (`is_outgoing == true`).
   */
  remote_paid_on: number;
}

/** The object type and id another object is related to. */
export interface RelatedObject {
  /** Object type identifier */
  type: string;
  /** Object ID */
  id: string;
}

type Flow =
  // Merchant API
  | "api"
  // Direct POST request
  | "direct_post"
  // Fluent Forms integration
  | "fluentforms"
  // Formidable Forms integration
  | "formidableforms"
  // GiveWP integration
  | "givewp"
  // Gravity Forms integration
  | "gravityforms"
  // Hostbill integration
  | "hostbill"
  // External system
  | "import"
  // Shared link
  | "link"
  // Magento module
  | "magento"
  // OpenCart module
  | "opencart"
  // Payform gateway
  | "payform"
  // Paymattic integration
  | "paymattic"
  // PrestaShop module
  | "prestashop"
  // Server to server API
  | "server_to_server"
  // Shopify integration
  | "shopify"
  // Merchant portal
  | "web_office"
  // WHMCS integration
  | "whmcs"
  // WooCommerce module
  | "woocommerce"
  // WPCharitable integration
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
  /** Type of action attempted */
  type: AttemptType;
  /** If this attempt was successful or not. For `false`, `error` of this attempt will be not null. */
  successful: boolean;
  /** Payment method used for this attempt. */
  payment_method: string;
  /** Extra data associated with selected payment method. Dataset depends on payment method. */
  extra: Extra;
  /**
   * Country code (in the ISO 3166-1 alpha-2 format e.g. 'GB') where payment tool used originates
   * (e.g. in case of card payments, the card issuing country).
   *
   * Will be blank if country could not be detected.
   */
  country: string;
  /** IP the paying client made this attempt from, if available. */
  client_ip: string;
  /** Time (if possible, fetched from the remote processing system) this attempt happened at. */
  processing_time: number;
  /** Code and description of the error encountered. Not-null if `successful` parameter of this attempt is `false`. */
  error: AttemptError;
}

export interface TransactionData {
  /** Payment method used if Purchase was paid, blank string otherwise. */
  payment_method: string;
  /** Flow or pathway used to initiate or execute a transaction. */
  flow: Flow;
  /** ID of the transaction in the processing system. */
  processing_tx_id: string;
  /**
   * Extra data associated with selected payment method if Purchase was paid, empty object otherwise.
   * Dataset depends on payment method.
   */
  extra: Extra;
  /**
   * Country code (in the ISO 3166-1 alpha-2 format e.g. 'GB') where payment tool used originates
   * (e.g. in case of card payments, the card issuing country).
   *
   * Will be blank if Purchase was not paid or country could not be detected.
   */
  country: string;
  /** Will contain information about all the payment attempts made and errors encountered, if any. */
  attempts: Attempt[];
}
