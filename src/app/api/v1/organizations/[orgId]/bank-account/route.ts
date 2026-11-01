import { supabaseAdmin } from "@/services/supabase/admin";
import {
  hasOrgPermission,
  getAuthClaims,
} from "@/services/supabase/permission";
import { NextRequest, NextResponse } from "next/server";
import { bankNameForSwift } from "@/lib/malaysian-banks";
import { validateBankAccountRequest } from "./validators";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The organization's payout destination.
 *
 * Gated on `bank_account.manage`, which only the org `owner` holds — a
 * delegated `admin` has no business reading or redirecting where the money
 * lands. Matches the RLS policy on organization_bank_accounts, which this route
 * bypasses by using the service-role client.
 *
 * NEITHER VERB EVER RETURNS THE FULL ACCOUNT NUMBER. The last 4 digits are
 * enough for an organizer to recognise their own account, and are all that
 * GET /api/v1/profile exposes for the player equivalent.
 */
async function authorize(
  orgId: string,
): Promise<{ userId: string } | { error: NextResponse }> {
  if (!UUID_RE.test(orgId)) {
    return {
      error: NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid organization ID",
          },
        },
        { status: 400 },
      ),
    };
  }

  const claims = await getAuthClaims();

  if (!claims) {
    return {
      error: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 },
      ),
    };
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .is("deleted_at", null)
    .single();

  if (orgError || !org) {
    if (orgError && orgError.code !== "PGRST116") {
      return {
        error: NextResponse.json(
          { error: { code: "INTERNAL_ERROR", message: orgError.message } },
          { status: 500 },
        ),
      };
    }
    return {
      error: NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        { status: 404 },
      ),
    };
  }

  // Deliberately no approval_status check: an organization must be able to fix
  // its bank details while pending, and after a rejection, otherwise a typo at
  // application time is unrecoverable.
  const allowed = await hasOrgPermission(
    claims.id,
    orgId,
    "bank_account.manage",
  );

  if (!allowed) {
    return {
      error: NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        { status: 403 },
      ),
    };
  }

  return { userId: claims.id };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  const auth = await authorize(orgId);
  if ("error" in auth) return auth.error;

  const { data, error } = await supabaseAdmin
    .from("organization_bank_accounts")
    .select(
      "bank_name, bank_code, account_holder, account_number, status, rejection_reason, verified_at",
    )
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ data: null }, { status: 200 });
  }

  const { account_number, ...rest } = data;

  return NextResponse.json(
    {
      data: {
        ...rest,
        account_number_last4: account_number.slice(-4),
      },
    },
    { status: 200 },
  );
}

/**
 * Replace the payout destination.
 *
 * PUT rather than PATCH because there is nothing partial about it: the RPC
 * supersedes the active row wholesale, so a caller must send a complete set of
 * details. A save that changes nothing is a no-op and keeps any existing
 * verification (`changed: false`); anything else resets the account to
 * `pending`, which is the whole point — details that changed have not been
 * verified.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  const auth = await authorize(orgId);
  if ("error" in auth) return auth.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  const validated = validateBankAccountRequest(rawBody);
  if ("error" in validated) return validated.error;
  const body = validated.data;

  const { data, error } = await supabaseAdmin.rpc(
    "set_organization_bank_account",
    {
      p_org_id: orgId,
      p_bank_code: body.bank_code,
      p_bank_name: bankNameForSwift(body.bank_code),
      p_account_holder: body.account_holder,
      p_account_number: body.account_number,
      p_actor_id: auth.userId,
    },
  );

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        { status: 404 },
      );
    }
    // uniq_active_bank_destination — one account cannot be the active payout
    // destination for two organizations (002_indexes.sql).
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error: {
            code: "BANK_ACCOUNT_IN_USE",
            message:
              "This bank account is already the payout destination for another organization",
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  // The RPC already returns the masked shape.
  return NextResponse.json({ data }, { status: 200 });
}
