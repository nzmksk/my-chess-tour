import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { bankNameForSwift } from "@/lib/reference/malaysian-banks";
import { validateBankAccountRequest } from "@/app/api/v1/organizations/[orgId]/bank-account/validators";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { afterResponse } from "@/lib/http/after-response";
import { sendAwardsAwaitingBank } from "@/services/prizes/execute";

// The player's prize destination (player_bank_accounts, #523). Freely editable
// (bank accounts change), but never updated in place: set_player_bank_account
// supersedes the active row, so a change always goes back to `pending` and is
// re-verified with CHIP Send before a prize is sent to it.
//
// Same request shape as the organization payout destination: a SWIFT code
// chosen from the list (the server derives the bank's display name from it), the
// holder and the account number. Sending all three as null clears the details.
//
// NEVER RETURNS THE FULL ACCOUNT NUMBER: the RPC answers with the last 4 digits.
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

  const clearing =
    body !== null &&
    typeof body === "object" &&
    body.bank_code === null &&
    body.account_holder === null &&
    body.account_number === null;

  let details: {
    bank_code: string | null;
    bank_name: string | null;
    account_holder: string | null;
    account_number: string | null;
  };

  if (clearing) {
    details = {
      bank_code: null,
      bank_name: null,
      account_holder: null,
      account_number: null,
    };
  } else {
    const validated = validateBankAccountRequest(body);
    if ("error" in validated) return validated.error;
    details = {
      ...validated.data,
      // The validator only accepts codes on the list, so this always resolves.
      bank_name: bankNameForSwift(validated.data.bank_code) ?? null,
    };
  }

  const { data, error } = await supabaseAdmin.rpc("set_player_bank_account", {
    p_user_id: claims.id,
    p_bank_code: details.bank_code,
    p_bank_name: details.bank_name,
    p_account_holder: details.account_holder,
    p_account_number: details.account_number,
  });

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "User not found" } },
        { status: 404 },
      );
    }
    return internalErrorResponse(
      "PATCH /api/v1/profile/banking: set_player_bank_account failed",
      error,
    );
  }

  // Already masked by the RPC. A cleared account comes back with id null.
  const result = data as { id: string | null; status?: string } & Record<string, unknown>;

  // A winner fixing or adding their details: any approved prize waiting on them
  // is registered with CHIP and sent now, after the response, rather than on the
  // next daily run. With nothing waiting this is one query and no CHIP call.
  if (result.id !== null && result.status !== "rejected") {
    afterResponse(() => sendAwardsAwaitingBank(claims.id));
  }
  return NextResponse.json(
    { data: result.id === null ? null : result },
    { status: 200 },
  );
}
