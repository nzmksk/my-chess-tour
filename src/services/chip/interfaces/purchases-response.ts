import type {
  Client,
  ClientDetails,
  PaymentMethod,
  Platform,
  Product,
} from "./common";

interface Purchase {
  /**
   * Line items of the invoice.
   *
   * In case of a transaction with no invoice sent, specify a single Product forming the cost of transaction.
   */
  products: Product[];
  /** Currency code in the ISO 4217 format, e.g. "USD" */
  currency: string;
  total: number;
  /** Language code in the ISO 639-1 format, e.g. "en" */
  language: string;
  notes: string;
  debt: number;
  subtotal_override: number | null;
  total_tax_override: number | null;
  total_discount_override: number | null;
  /** If specified and not null, will override the total price for this purchase */
  total_override: number;
  /**
   * List of client details to request from the client.
   *
   * It is advisable to include `full_name` in request body.
   */
  request_client_details: ClientDetails[];
  /** Timezone to localize invoice-specific timestamps in, e.g. to display a concrete date for a `due` timestamp on the invoice. */
  timezone: string;
  /**
   * Whether to permit payments when Purchase's `due` has passed.
   * By default those are permitted (and status will be set to `overdue` once `due` moment is passed).
   * If this is set to `true`, it won't be possible to pay for an overdue invoice,
   * and when `due` is passed the Purchase`s status will be set to `expired`.
   */
  due_strict: boolean;
  /** An optional message to display to your customer in invoice email, e.g. "Your invoice for June". */
  email_message: string;
  /** Shipping options available for this purchase. */
  shipping_options: object[];
  /** Payment method specific details */
  payment_method_details: object;
  /** Indicates if the purchase has upsell products. */
  has_upsell_products: boolean;
  /** If true, only a single payment attempt is allowed */
  single_attempt: boolean;
  metadata: object;
}

type PaymentType =
  | "purchase"
  | "purchase_charge"
  | "payout"
  | "bank_payment"
  | "refund"
  | "custom";

interface Payment {
  /**
   * Denotes the direction of payment, e.g. for a paid Purchase, is granted to be `false`, `true` for payouts.
   * @default false
   */
  is_outgoing: boolean;
  payment_type: PaymentType;
  amount: number;
  /**
   * Currency code in the ISO 4217 standard.
   * @example "EUR"
   */
  currency: string;
  net_amount: number;
  fee_amount: number;
  pending_amount: number;
  pending_unfreeze_on: number | null;
  description: string;
  /** When the payment was accepted in (`is_outgoing == false`) or sent from (`is_outgoing == true`) the gateway system. */
  paid_on: number;
  /**
   * If available, this field will report the date the payment was sent by the remote payer (`is_outgoing == false`)
   * or when funds arrived to the remote beneficiary (`is_outgoing == true`).
   */
  remote_paid_on: number;
}

interface BankAccount {
  /** Bank account number (e.g. IBAN) */
  bank_account: string;
  /** SWIFT/BIC code of the bank */
  bank_code: string;
}

interface IssuerDetails {
  /** Company website URL  */
  website: string;
  /** Street house number and flat address where applicable */
  legal_street_address: string;
  /**
   * Country code in the ISO 3166-1 alpha-2 format
   * @example 'GB'
   */
  legal_country: string;
  /** City name */
  legal_city: string;
  /** ZIP or postal code */
  legal_zip_code: string;
  bank_accounts: BankAccount[];
  /** Legal name of the company */
  legal_name: string;
  /** Brand name of the company */
  brand_name: string;
  /** Registration number of the company */
  registration_number: string;
  /** Tax payer registration number */
  tax_number: string;
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

type AttemptType =
  | "execute"
  | "authorize"
  | "release"
  | "capture"
  | "recurring_execute"
  | "delete_recurring_token"
  | "refund";

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

interface TransactionData {
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

interface RelatedObject {
  type: string;
  id: string;
}

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
  /** Currency this purchase was initially created with */
  original_currency: string;
  original_amount: number;
  /**
   * Exchanged rate that was used for currency conversion.
   * Original amount was multiplied by this number to calculate the new purchase amount.
   */
  exchange_rate: number;
}

type GatewayProduct = "purchases";

/**
 * Record of a single purchase operation, either a transaction originating from e-commerce integration or invoice sent.
 * Has a status attribute, e.g. can be "created", "paid", or "refunded".
 *
 * To run payments in your application use `POST /purchases/`,
 * request to register payments and receive the checkout link (`checkout_url`).
 * After the payment is processed, gateway will redirect the client back to your website
 * (take note of `success_redirect`, `failure_redirect`).
 */
export interface PurchasesResponse {
  /** Either this or `client_id` is required */
  client: Client;
  /** Core information about the Purchase, including the products, total, currency, and invoice fields. */
  purchase: Purchase;
  /** Brand ID to create this Purchase for. */
  brand_id: string;
  /** Object type identifier */
  type: string;
  id: string;
  /** Object creation time */
  created_at: number;
  /** Object last modification time */
  updated_on: number;
  /**
   * Details of an executed transaction. Read-only for `Purchases` and `Payouts`.
   * For an unpaid `Purchase`, this object will be `null`. */
  payment: Payment | null;
  /** Read-only details of issuer company/brand, persisted for invoice display. */
  issuer_details: IssuerDetails;
  /**
   * Payment method-specific, read-only transaction data.
   * Will contain information about all the transaction attempts and possible errors, if available.
   */
  transaction_data: TransactionData;
  /**
   * Purchase status.
   * @argument created - Purchase was created using POST /purchases/ or the merchant portal.
   * @argument sent - Invoice for this purchase was sent over email.
   * @argument viewed - The client has viewed the payform and/or invoice details for this purchase.
   * @argument error -  There was a failed payment attempt for this purchase because
   * of a problem with customer's payment instrument (e.g. low account balance).
   * You can analyze the `.transaction_data` to get information on reason of the failure.
   * @argument cancelled -  Purchase was cancelled using the POST `/purchases/{id}/cancel/` endpoint;
   * payment for it is not possible anymore.
   * @argument overdue - Purchase is past its `.due`, but payment for it is still possible
   * (unless e.g. POST `/purchases/{id}/cancel/` is used).
   * @argument expired -  Purchase is past its `.due` and payment for it isn't possible anymore
   * (as a result of `purchase.due_strict` having been set to `true`).
   * @argument blocked -  Like `error`, but payment attempt was blocked due to
   * fraud scoring below threshold or other security checks not passing.
   * @argument hold - Funds are on hold for this Purchase (`.skip_capture: true` was used).
   * You can now run `POST /capture/` or `POST /release/` for this payment
   * to capture the payment or return funds to the client, respectively.
   * @argument released - This Purchase previously had `hold` status,
   * but funds have since been released and returned to the customer's card.
   * @argument pending_release -  release of funds for this Purchase is in processing, but is not finalized on the acquirer side yet.
   * Is set by `POST /purchases/{id}/release/` operation when it takes longer than expected to process on the acquirer side.
   * @argument pending_capture - capture of funds for this Purchase is in processing, but is not finalized on the acquirer side yet.
   * Is set by `POST /purchases/{id}/capture/` operation when it takes longer than expected to process on the acquirer side.
   * @argument preauthorized - A preauthorization of a card (authorization of card data without a financial transaction)
   * was executed successfully using this Purchase.
   * See the description of the `.skip_capture` field for more details.
   * @argument paid -  Purchase was successfully paid for.
   * @argument pending_execute - Payment (or `hold` in case of `skip_capture`) for this Purchase is in processing,
   * but is not finalized on the acquirer side yet.
   * @argument pending_charge - Recurring payment for this Purchase is in processing, but is not finalized on the acquirer side yet.
   * Is set by `POST /purchases/{id}/charge/` operation when it takes longer than expected to process on the acquirer side.
   * @argument cleared - Funds for this Purchase (that was already `paid`) have been transferred for clearing in payment card network.
   * All non-card payment methods and some card payment methods (depends on configuration) don't use this status
   * and Purchases paid using them stay in `paid` status instead.
   * @argument settled - Settlement was issued for funds for this Purchase (that was already `paid`).
   * All non-card payment methods and some card payment methods (depends on configuration) don't use this status
   * and Purchases paid using them stay in `paid` status instead.
   * @argument chargeback - A chargeback was registered for this, previously paid, Purchase.
   * @argument pending_refund - A refund (full or partial) for this Purchase is in processing,
   * but is not finalized on the acquirer side yet.
   * Is set by `POST /purchases/{id}/refund/` operation when it takes longer than expected to process on the acquirer side.
   * @argument refunded - This Purchase had its payment refunded, fully or partially.
   */
  status: PurchaseStatus;
  /**
   * History of status changes, latest last.
   * Might contain entry about a related object, e.g. status change to `refunded` will contain a reference to the refund Payment.
   */
  status_history: PurchaseStatusHistory[];
  /** Time the payment form or invoice page was first viewed on */
  viewed_on: number;
  company_id: string;
  /** Indicates this is a test object, created using test API keys or using the merchant portal while in test mode. */
  is_test: boolean;
  /** ID of user who has created this object in the merchant portal, if applicable. */
  user_id: string | null;
  /**
   * ID of a Client object used to initialize ClientDetails (`.client`) of this Purchase.
   * Either this field or specifying `.client` object is required (you can only specify a value for one of these fields).
   * All `ClientDetails` fields from the Client will be copied to `.client` object.
   * Note that editing Client object won't change the respective fields in already created Purchases.
   *
   * If you specify this field and your client saves a `recurring_token` (for instance, by saving their card),
   * the respective ClientRecurringToken will be created. See the `/clients/{id}/recurring_tokens/` endpoint.
   */
  client_id: string | null;
  /** Whether to send receipt email for this Purchase when it's paid. */
  send_receipt: boolean;
  /**
   * Indicates whether a recurring token (e.g. for card payments - card token) was saved for this Purchase.
   * If this is `true`, the id of this Purchase can be used as a `recurring_token` in `POST /purchases/{id}/charge/`,
   * enabling you to pay for that Purchase using the same method (same card for card payments) that this one was paid with.
   */
  is_recurring_token: boolean;
  /** ID of a recurring token (Purchase having `is_recurring_token == true`) that was used to pay this Purchase, if any. */
  recurring_token: string | null;
  /**
   * Card payment-specific: if set to `true`, only authorize the payment (place funds on hold) when payer enters his card data and pays.
   * This option requires a `POST /capture/` or `POST /release/` later on.
   *
   * You can use the preauthorization feature if you set this parameter to `true` and make the Purchase with `purchase.total == 0`
   * (this can be achieved by providing a list of `purchase.products` with a total `price` of 0,
   * or simply overriding the total using `purchase.total_override` to 0).
   * The resulting Purchase can only be "paid" by the client
   * (only cardholder data verification will happen, without a financial transaction) by card and will enforce saving the client's card.
   * When this happens, the Purchase will have `status` of `preauthorized` and the `purchase.preauthorized` webhook callbacks will be emitted.
   *
   * Trying to use skip_capture (or preauthorization) without any payment methods that support the respective actions
   * (this can be a result of `payment_method_whitelist` field being used) will result in an error on Purchase creation request step.
   * Please check the `GET /payment_methods/` response for your desired Purchase parameters and/or consult with your account manager.
   *
   * @default false
   */
  skip_capture: boolean;
  /**
   * If the used payment method supports recurring payment functionality,
   * forces the customer's payment credentials to be saved for possible later recurring payments,
   * without giving the customer a choice in the matter.
   *
   * @default false
   */
  force_recurring: boolean;
  /** If you don't provide an invoice `reference` yourself, this autogenerated value will be used as a reference instead. */
  reference_generated: string;
  /** Invoice reference */
  reference: string;
  /** Add any additional information. */
  notes: string;
  /**
   * Value for 'Invoice issued' field. Display-only, does not get validated.
   * If not provided, will be generated as the current date in `purchase.timezone` at the moment of Purchase's creation.
   *
   * @example "2020-04-30"
   */
  issued: string | null;
  /**
   * When the payment is due for this Purchase.
   * The default behaviour is to still allow payment once this moment passes.
   * To change that, set `purchase.due_strict` to `true`.
   *
   * @example 1619740800
   */
  due: number | null;
  /** Specifies, if the purchase can be refunded fully and partially, only fully, partially or not at all. */
  refund_availability: RefundAvailability;
  refundable_amount: number;
  /**
   * This object is present when automatic currency conversion has occurred upon creation of the purchase.
   * Purchase's original currency was changed and its original amount was converted using the exchange rate shown here.
   */
  currency_conversion: CurrencyConversion | null;
  /**
   * An optional whitelist of payment methods available for this purchase.
   *
   * Use this field if you want to restrict your payer to pay using only one or several specific methods.
   *
   * Using this field and at the same time trying to use specific capabilities of a Purchase
   * (e.g. `skip_capture` or charging it using a saved card token using POST `/purchases/{id}/charge/`)
   * can cause a situation when there are no payment methods available for paying this Purchase.
   *
   * This will cause a validation error on Purchase creation.
   *
   * Please check the GET `/payment_methods/` response for your desired Purchase parameters and/or consult with your account manager.
   */
  payment_method_whitelist: PaymentMethod[];
  /** When Purchase is paid for successfully, your customer will be taken to this link. Otherwise a standard screen will be displayed. */
  success_redirect: string;
  /**
   * If there's a payment failure for this Purchase, your customer will be taken to this link.
   *
   * Otherwise a standard screen will be displayed.
   */
  failure_redirect: string;
  /**
   * If you provide this link, customer will have an option to go to it instead of making payment
   * (a button with 'Return to seller' text will be displayed).
   *
   * Can't contain any of the following symbols: `<>`, `'`, `"`
   *
   * Be aware that this does not cancel the payment (e.g. does not do the equivalent of doing the POST /purchases/{id}/cancel/ request);
   * the client will still be able to press 'Back' in the browser and perform the payment.
   */
  cancel_redirect: string;
  /**
   * When Purchase is paid for successfully,
   * the `success_callback` URL will receive a POST request with the Purchase object's data in body.
   */
  success_callback: string;
  /** Identification of software (e.g. an ecommerce module and version) used to create this purchase, if any. */
  creator_agent: string;
  /** Platform this Purchase was created on */
  platform: Platform;
  /** Defines which gateway product was used to create this Purchase. */
  product: GatewayProduct;
  /** IP the Purchase was created from. */
  created_from_ip: string;
  /** URL you will be able to access invoice for this Purchase at, if applicable */
  invoice_url: string | null;
  /**
   * URL you will be able to access the checkout for this Purchase at, if payment for it is possible.
   * When building integrations, redirect the customer to this URL once purchase is created.
   *
   * You can add the `preferred` query arg to the `checkout_url` in order to force redirect the client straight to the checkout
   * for a specific payment method (`?preferred={payment_method}`, where `{payment_method}` is the payment method name as returned
   * by `GET /payment_methods/`).
   * If this method redirects the client further to a different system and no customer data entry is needed on gateway's checkout page,
   * your payer will be taken straight to that page (not seeing the gateway's checkout UI);
   * otherwise, he will see the payment method entry UI on the gateway checkout page.
   *
   * You can also add the `active` query arg to the `checkout_url` in order to pre-select a specific payment method
   * on the default payment page without skipping it (`?active={payment_method}`, where `{payment_method}` is the payment method name
   * as returned by `GET /payment_methods/`).
   * Unlike `?preferred={payment_method}`, the customer still sees the default payment page and can switch to a different method.
   * The `?active=` parameter does not restrict which methods are available.
   */
  checkout_url: string;
  /**
   * URL that can be used for Direct Post integration.
   *
   * This functionality is activated for each merchant account individually.
   * Please consult with your account manager if you wish to use it.
   *
   * Will be null if payment for purchase is not possible, `purchase.request_client_details` isn't empty
   * or `success_redirect`/`failure_redirect` are not provided - these all break the usual direct post flow.
   *
   * To leverage Direct Post checkout:
   * @example
   * ```html
   * <form method="POST" action="{direct_post_url value}">
   *   <input
   *      type="text"
   *      name="cardholder_name"
   *      value="" # Latin letters, space, apostrophe, dot, and dash symbols only
   *   />
   *   <input
   *      type="text"
   *      name="card_number"
   *      value="" # Digits only, no whitespace, max 19 chars
   *   />
   *   <input
   *      type="text"
   *      name="expires"
   *      value="" # in 'MM/YY' format, digits and a slash only /^\d{2}\/\d{2}$/, max 5 chars
   *   />
   *   <input
   *      type="text"
   *      name="cvc"
   *      value="" # numeric string of 3 or 4 digits
   *   />
   *   <input
   *      type="checkbox"
   *      name="remember_card" # default value is `on` when omitting value attribute of a checkbox input
   *   />
   * </form>
   * ```
   *
   * Ensure the validation as listed above!
   * Validation errors will be treated as payment failures.
   * Obviously, you can style this form to fit in with the rest of your website.
   *
   * When your payer submits this form (don't forget a `<button>` or `<input type="submit">`),
   * he will POST the data directly to the gateway system.
   * There, with minimal interaction with gateway's interface, payment will be processed.
   * In the process, your customer might get redirected to authenticate against 3D Secure system of his card issuer bank
   * (this depends on settings of his card and your account).
   * After that, payer will be taken to `success_redirect` or `failure_redirect` depending on the payment result
   * (as in the usual payment flow).
   *
   * Be aware, though, that while not having to process card data allows you not to comply with the entirety of PCI DSS SAQ D requirements,
   * having sensitive cardholder data entry form on your website does raise your PCI DSS scope to SAQ A-EP.
   *
   * Contact your account manager to receive advisory and assistance for this integration method.
   */
  direct_post_url: string | null;
  /** True if a purchase was manually marked as paid. */
  marked_as_paid: boolean;
  /** ID of corresponding order. */
  order_id: string;
  /** Upsell campaigns associated with this purchase. */
  upsell_campaigns: object;
  /** ID of the referral campaign. */
  referral_campaign_id: string | null;
  /** Referral code used. */
  referral_code: string | null;
  /** Details of the referral code. */
  referral_code_details: object | null;
  /** Generated referral code. */
  referral_code_generated: object | null;
  retain_level_details: object | null;
  /** Indicates if the purchase can be retrieved. */
  can_retrieve: boolean;
  /** Indicates if the purchase can be charged back. */
  can_chargeback: boolean;
  /** Indicates if the purchase can have its chargeback reversed. */
  can_reverse_chargeback: boolean;
  /** Tags associated with this Purchase */
  tags?: string[];
}
