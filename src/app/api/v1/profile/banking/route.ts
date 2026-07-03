import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import type { UpdateBankingPayload } from "@/app/profile/types";

// Player banking / payout details. Unlike the other profile fields these are
// freely editable (bank accounts change) and never set-once. The full account
// number is written here but never returned by GET /api/v1/profile, which
// exposes only the last 4 digits. Callers must send a complete set of the three
// fields; sending all three as null clears the banking details.
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const errors: string[] = [];

  const clearing =
    body.bank_name === null &&
    body.bank_account_holder === null &&
    body.bank_account_number === null;

  const update: UpdateBankingPayload = {
    bank_name: null,
    bank_account_holder: null,
    bank_account_number: null,
  };

  if (!clearing) {
    // bank_name
    if (typeof body.bank_name === "string" && body.bank_name.trim()) {
      const value = body.bank_name.trim();
      if (value.length > 100) {
        errors.push("bank_name must be 100 characters or fewer");
      } else {
        update.bank_name = value;
      }
    } else {
      errors.push("bank_name must be a non-empty string");
    }

    // bank_account_holder
    if (
      typeof body.bank_account_holder === "string" &&
      body.bank_account_holder.trim()
    ) {
      const value = body.bank_account_holder.trim();
      if (value.length > 255) {
        errors.push("bank_account_holder must be 255 characters or fewer");
      } else {
        update.bank_account_holder = value;
      }
    } else {
      errors.push("bank_account_holder must be a non-empty string");
    }

    // bank_account_number — strip spaces/dashes, then digits only, length 5-20.
    if (typeof body.bank_account_number === "string") {
      const digits = body.bank_account_number.replace(/[\s-]/g, "");
      if (/^\d{5,20}$/.test(digits)) {
        update.bank_account_number = digits;
      } else {
        errors.push(
          "bank_account_number must contain 5 to 20 digits (spaces and dashes allowed)",
        );
      }
    } else {
      errors.push("bank_account_number must be a string");
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: errors.join("; ") } },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("player_profiles")
    .upsert({ user_id: claims.id, ...update }, { onConflict: "user_id" });

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
