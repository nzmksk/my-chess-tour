import type {
  Client,
  ClientDetails,
  PaymentMethod,
  Platform,
  Product,
} from "./common";

interface Purchase {
  products: Product[];
  currency?: string;
  language?: string;
  notes?: string;
  debt?: number;
  subtotal_override?: number | null;
  total_tax_override?: number | null;
  total_discount_override?: number | null;
  total_override?: number;
  request_client_details?: ClientDetails[];
  timezone?: string;
  due_strict?: boolean;
  email_message?: string;
  shipping_options?: object[];
  payment_method_details?: object;
  has_upsell_products?: boolean;
  single_attempt?: boolean;
  metadata?: object;
}

export interface PurchasesRequest {
  client: Client;
  purchase: Purchase;
  brand_id: string;
  client_id?: string | null;
  send_receipt?: boolean;
  skip_capture?: boolean;
  force_recurring?: boolean;
  reference?: string;
  issued?: string;
  due?: number;
  payment_method_whitelist?: PaymentMethod[];
  success_redirect?: string;
  failure_redirect?: string;
  cancel_redirect?: string;
  success_callback?: string;
  creator_agent?: string;
  platform?: Platform;
  tags?: string[];
}
