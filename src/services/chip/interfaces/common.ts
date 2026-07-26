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
