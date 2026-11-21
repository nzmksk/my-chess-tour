import type { PaymentMethod } from "./interfaces/common";

const LABELS: Record<PaymentMethod, string> = {
  fpx: "FPX online banking",
  fpx_b2b1: "FPX business banking",
  crypto_coin: "cryptocurrency",
  dnqr: "DuitNow QR",
  duitnow_qr: "DuitNow QR",
  maestro: "your Maestro card",
  mastercard: "your Mastercard",
  mpgs_apple_pay: "Apple Pay",
  mpgs_google_pay: "Google Pay",
  razer_atome: "Atome",
  razer_grabpay: "GrabPay",
  razer_maybankqr: "Maybank QR",
  razer_shopeepay: "ShopeePay",
  razer_tng: "Touch 'n Go eWallet",
  shopee_pay: "ShopeePay",
  visa: "your Visa card",
};

const FALLBACK = "your original payment method";

export function describePaymentMethod(raw: string | null | undefined): string {
  if (!raw) return FALLBACK;
  return Object.hasOwn(LABELS, raw) ? LABELS[raw as PaymentMethod] : FALLBACK;
}
