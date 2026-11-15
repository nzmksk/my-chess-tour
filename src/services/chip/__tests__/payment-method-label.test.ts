import { describe, expect, it } from "vitest";
import { describePaymentMethod } from "../payment-method-label";

describe("describePaymentMethod", () => {
  it.each([
    ["fpx", "FPX online banking"],
    ["visa", "your Visa card"],
    ["razer_tng", "Touch 'n Go eWallet"],
    ["duitnow_qr", "DuitNow QR"],
  ])("names %s", (raw, label) => {
    expect(describePaymentMethod(raw)).toBe(label);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["a channel we don't know", "some_new_wallet"],
    ["an inherited property name", "toString"],
  ])("falls back for %s", (_label, raw) => {
    expect(describePaymentMethod(raw)).toBe("your original payment method");
  });
});
