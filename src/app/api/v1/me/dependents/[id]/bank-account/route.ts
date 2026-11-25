import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { bankNameForSwift } from "@/lib/reference/malaysian-banks";
import { validateBankAccountRequest } from "@/app/api/v1/organizations/[orgId]/bank-account/validators";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { afterResponse } from "@/lib/http/after-response";
import { holderNamesMatch } from "@/services/payouts/holder-name";
import { sendAwardsAwaitingBank } from "@/services/prizes/execute";
import { dependentNotFoundResponse } from "@/services/guardianship/dependents";
import { resolveDependentForCaller } from "@/services/guardianship/resolve-dependent";
import { withAuditContext } from "@/services/supabase/audit-context";

type RouteContext = { params: Promise<{ id: string }> };

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

const MINOR_MESSAGE =
  "A minor's prizes are paid into their guardian's bank account. Add your own bank details in Settings instead.";

type SetResult = { id: string | null; status?: string } & Record<
  string,
  unknown
>;

async function saveDetails(
  route: string,
  guardianId: string,
  dependentId: string,
  details: {
    bank_code: string | null;
    bank_name: string | null;
    account_holder: string | null;
    account_number: string | null;
  },
): Promise<
  { ok: true; result: SetResult } | { ok: false; response: NextResponse }
> {
  const { data, error } = await supabaseAdmin.rpc("set_player_bank_account", {
    p_user_id: dependentId,
    p_bank_code: details.bank_code,
    p_bank_name: details.bank_name,
    p_account_holder: details.account_holder,
    p_account_number: details.account_number,
    p_entered_by: guardianId,
  });
  if (!error) return { ok: true, result: data as SetResult };

  if (error.code === "P0002" || error.message?.startsWith("NOT_GUARDIAN")) {
    return { ok: false, response: dependentNotFoundResponse() };
  }
  if (error.message?.startsWith("MINOR_DEPENDENT")) {
    return {
      ok: false,
      response: errorResponse("MINOR_DEPENDENT", MINOR_MESSAGE, 409),
    };
  }
  if (error.message?.startsWith("CONSENT_REQUIRED")) {
    return {
      ok: false,
      response: errorResponse(
        "CONSENT_REQUIRED",
        "Record the player's consent to storing their bank details before saving them",
        409,
      ),
    };
  }
  return {
    ok: false,
    response: internalErrorResponse(
      `${route}: set_player_bank_account failed`,
      error,
    ),
  };
}

async function handlePut(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const route = "PUT /api/v1/me/dependents/[id]/bank-account";
  const resolved = await resolveDependentForCaller(id, route);
  if (!resolved.ok) return resolved.response;
  const { guardianId, dependent } = resolved;

  if (dependent.basis === "minor") {
    return errorResponse("MINOR_DEPENDENT", MINOR_MESSAGE, 409);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_JSON", "Invalid JSON body", 400);
  }
  const validated = validateBankAccountRequest(body);
  if ("error" in validated) return validated.error;

  const playerName = `${dependent.first_name} ${dependent.last_name}`;
  if (!holderNamesMatch(validated.data.account_holder, playerName)) {
    return errorResponse(
      "HOLDER_NOT_PLAYER",
      `The account must be in ${playerName}'s name. A prize is only paid into the player's own account.`,
      422,
    );
  }

  const saved = await saveDetails(route, guardianId, dependent.id, {
    ...validated.data,
    bank_name: bankNameForSwift(validated.data.bank_code) ?? null,
  });
  if (!saved.ok) return saved.response;

  if (saved.result.id !== null && saved.result.status !== "rejected") {
    afterResponse(() => sendAwardsAwaitingBank(dependent.id));
  }
  return NextResponse.json({ data: saved.result });
}

async function handleDelete(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const route = "DELETE /api/v1/me/dependents/[id]/bank-account";
  const resolved = await resolveDependentForCaller(id, route);
  if (!resolved.ok) return resolved.response;

  const saved = await saveDetails(
    route,
    resolved.guardianId,
    resolved.dependent.id,
    {
      bank_code: null,
      bank_name: null,
      account_holder: null,
      account_number: null,
    },
  );
  if (!saved.ok) return saved.response;
  return NextResponse.json({ data: null });
}

export const PUT = withAuditContext("dependent.banking.set", handlePut);
export const DELETE = withAuditContext("dependent.banking.clear", handleDelete);
