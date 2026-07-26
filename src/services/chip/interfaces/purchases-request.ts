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
  currency?: string;
  /** Language code in the ISO 639-1 format, e.g. "en" */
  language?: string;
  notes?: string;
  /** @default 0 */
  debt?: number;
  subtotal_override?: number | null;
  total_tax_override?: number | null;
  total_discount_override?: number | null;
  /** If specified and not null, will override the total price for this purchase */
  total_override?: number;
  /**
   * List of client details to request from the client.
   *
   * It is advisable to include `full_name` in request body.
   */
  request_client_details?: ClientDetails[];
  /** Timezone to localize invoice-specific timestamps in, e.g. to display a concrete date for a `due` timestamp on the invoice. */
  timezone?: string;
  /**
   * Whether to permit payments when Purchase's `due` has passed.
   * By default those are permitted (and status will be set to `overdue` once `due` moment is passed).
   * If this is set to `true`, it won't be possible to pay for an overdue invoice,
   * and when `due` is passed the Purchase`s status will be set to `expired`.
   */
  due_strict?: boolean;
  /** An optional message to display to your customer in invoice email, e.g. "Your invoice for June". */
  email_message?: string;
  /** Shipping options available for this purchase. */
  shipping_options?: object[];
  /** Payment method specific details */
  payment_method_details?: object;
  /** Indicates if the purchase has upsell products. */
  has_upsell_products?: boolean;
  /** If true, only a single payment attempt is allowed */
  single_attempt?: boolean;
  metadata?: object;
}

/**
 * Create a purchase
 *
 * To run payments in your application use `POST /purchases/`,
 * request to register payments and receive the checkout link (`checkout_url`).
 * After the payment is processed, gateway will redirect the client back to your website
 * (take note of `success_redirect`, `failure_redirect`).
 *
 * To set the price to the smallest unit possible, the value of the price field is expected to be specified in cents.
 * @example
 * ```
 * `price: 100` is equivalent to `RM1.00`
 * ```
 *
 * You have three options to check payment status:
 * 1. use `success_callback` parameter of `Purchase` object.
 * 2. use `GET /purchases/<purchase_id>/` request.
 * 3. set up a Webhook using the UI or Webhook API to listen to `purchase.paid` or `purchase.payment_failure` events on your server.
 * 
 * Using `skip_capture` flag allows you to separate the authentication and payment execution steps,
 * allowing you to reserve funds on payer’s card account for some time. This flag can also enable preauthorization capability,
 * allowing you to save the card without a financial transaction, if available.
 * 
 * When the client agrees to store their card during a purchase, they can pay with a single click on subsequent purchases.
 * 
 * Instead of a redirect you can also utilize Direct Post checkout:
 * you can create an HTML <form> on your website with `method="POST"` and
 * action pointing to `direct_post_url` of a created Purchase.
 * You will also need to populate the form with `<input>` elements for the card data fields.
 * As a result, when a payer submits their card data, it will be posted straight to our system,
 * allowing you to customize the checkout as you wish while your PCI DSS requirement is only raised to SAQ A-EP,
 * as your system doesn’t receive or process card data.
 * 
 * For more details, see the documentation on Purchase’s `direct_post_url` field.
 * 
 * To pay for test Purchases, use `4444 3333 2222 1111` as the card number, `123` as CVC,
 * any date/month greater than now as expiry and any (Latin) cardholder name.
 * Any other card number, CVC, or expiry earlier than the current month will cause a test payment to fail.
*/
export interface PurchasesRequest {
  /** Either this or `client_id` is required */
  client: Client;
  /** Core information about the Purchase, including the products, total, currency, and invoice fields. */
  purchase: Purchase;
  /** Brand ID to create this Purchase for. */
  brand_id: string;
  /**
   * ID of a Client object used to initialize ClientDetails of this Purchase.
   * Either this field or `client` is required. All ClientDetails fields from the Client will be copied to `client` object
   *
   * Note that editing Client object won't change the respective fields in already created Purchases.
   *
   * If you specify this field and your client saves a `recurring_token` (for instance, by saving their card),
   * the respective ClientRecurringToken will be created.
   *
   * See the `/clients/{id}/recurring_tokens/` endpoint.
   */
  client_id?: string | null;
  /** Whether to send receipt email for this Purchase when it's paid */
  send_receipt?: boolean;
  /**
   * Card-payment specific: if set to `true`, only authorize the payment (place funds on hold) when payer enters his card data and pays.
   * This option requires a POST `/capture/` or POST `/release/` later on.
   *
   * You can use the preauthorization feature if you set this parameter to true
   * and make the Purchase with `purchase.total == 0`
   * (this can be achieved by providing a list of `purchase.products` with a total price of 0,
   * or simply overriding the total using `purchase.total_override` to 0).
   *
   * The resulting Purchase can only be "paid" by the client
   * (only cardholder data verification will happen, without a financial transaction)
   * by card and will enforce saving the client's card.
   *
   * When this happens, the Purchase will have status of preauthorized
   * and the `purchase.preauthorized` webhook callbacks will be emitted.
   *
   * Trying to use `skip_capture` (or preauthorization) without any payment methods that support the respective actions
   * (this can be a result of `payment_method_whitelist` field being used) will result in an error on Purchase creation request step.
   *
   * Please check the GET `/payment_methods/` response for your desired Purchase parameters and/or consult with your account manager.
   */
  skip_capture?: boolean;
  /**
   * If the used payment method supports recurring payment functionality,
   * forces the customer's payment credentials to be saved for possible later recurring payments,
   * without giving the customer a choice in the matter.
   */
  force_recurring?: boolean;
  /** Invoice reference */
  reference?: string;
  /**
   * Value for 'Invoice issued' field. Display-only, does not get validated.
   *
   * If not provided, will be generated as the current date in `purchase.timezone` at the moment of Purchase's creation.
   */
  issued?: string;
  /**
   * When the payment is due for this Purchase in epoch time.
   *
   * The default behaviour is to still allow payment once this moment passes.
   *
   * To change that, set `purchase.due_strict` to true.
   */
  due?: number;
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
  payment_method_whitelist?: PaymentMethod[];
  /** When Purchase is paid for successfully, your customer will be taken to this link. Otherwise a standard screen will be displayed. */
  success_redirect?: string;
  /**
   * If there's a payment failure for this Purchase, your customer will be taken to this link.
   *
   * Otherwise a standard screen will be displayed.
   */
  failure_redirect?: string;
  /**
   * If you provide this link, customer will have an option to go to it instead of making payment
   * (a button with 'Return to seller' text will be displayed).
   *
   * Can't contain any of the following symbols: `<>`, `'`, `"`
   *
   * Be aware that this does not cancel the payment (e.g. does not do the equivalent of doing the POST /purchases/{id}/cancel/ request);
   * the client will still be able to press 'Back' in the browser and perform the payment.
   */
  cancel_redirect?: string;
  /**
   * When Purchase is paid for successfully,
   * the `success_callback` URL will receive a POST request with the Purchase object's data in body.
   */
  success_callback?: string;
  /** Identification of software (e.g. an ecommerce module and version) used to create this purchase, if any. */
  creator_agent?: string;
  /** Platform this Purchase was created on */
  platform?: Platform;
  /** Tags associated with this Purchase */
  tags?: string[];
}
