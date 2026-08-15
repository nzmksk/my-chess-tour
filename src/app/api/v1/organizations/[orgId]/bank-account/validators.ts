import { NextResponse } from "next/server";
import { BANK_SWIFT_CODES } from "@/lib/malaysian-banks";

export interface BankAccountRequest {
  bank_code: string;
  account_holder: string;
  /** Digits only — spaces and dashes are stripped here. */
  account_number: string;
}

// No bank_name field, deliberately: the server derives the display name from
// the SWIFT code (src/lib/malaysian-banks.ts). A client-supplied name could
// disagree with the code it arrived with, and the row would then read "Maybank"
// while the money went to CIMB.
export function validateBankAccountRequest(
  body: unknown,
): { data: BankAccountRequest } | { error: NextResponse } {
  const fail = (message: string) => ({
    error: NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message } },
      { status: 400 },
    ),
  });

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("Invalid request body");
  }

  const b = body as Record<string, unknown>;

  // An unknown SWIFT code is one CHIP Send will not recognise either, so it is
  // rejected here rather than becoming a failed payout later.
  if (typeof b.bank_code !== "string" || !BANK_SWIFT_CODES.has(b.bank_code)) {
    return fail("Please choose your bank from the list");
  }

  if (typeof b.account_holder !== "string" || b.account_holder.trim() === "") {
    return fail("Account holder name is required");
  }

  if (b.account_holder.trim().length > 255) {
    return fail("Account holder name must be 255 characters or fewer");
  }

  // Same normalization as PATCH /api/v1/profile/banking.
  if (typeof b.account_number !== "string") {
    return fail("Account number is required");
  }
  const accountNumber = b.account_number.replace(/[\s-]/g, "");
  if (!/^\d{5,20}$/.test(accountNumber)) {
    return fail(
      "Account number must contain 5 to 20 digits (spaces and dashes allowed)",
    );
  }

  return {
    data: {
      bank_code: b.bank_code,
      account_holder: b.account_holder.trim(),
      account_number: accountNumber,
    },
  };
}
