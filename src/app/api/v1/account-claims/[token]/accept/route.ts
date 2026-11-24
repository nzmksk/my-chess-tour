import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import { withAuditContext } from "@/services/supabase/audit-context";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { checkPasswordRequirements } from "@/services/auth/auth-validation";
import { TERMS_VERSION } from "@/lib/reference/legal";
import {
  EMAIL_TAKEN_MESSAGE,
  accountClaimErrorResponse,
  getAccountClaimByToken,
  type AccountClaimView,
} from "@/services/guardianship/account-claims";

type RouteContext = { params: Promise<{ token: string }> };

const CLOSED_MESSAGES: Record<
  Exclude<AccountClaimView["state"], "pending">,
  string
> = {
  expired:
    "This link has expired. Ask whoever sent it to send a new one from their dependents page.",
  accepted:
    "This link has already been used. Sign in with the email address it was sent to.",
  closed:
    "This link can't be used any more. Ask whoever sent it for a new one.",
};

function respond(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function handlePost(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const limited = await enforceRateLimit("signup", request, null);
  if (limited) return limited;

  const { token } = await context.params;

  let claim: AccountClaimView | null;
  try {
    claim = await getAccountClaimByToken(token);
  } catch (err) {
    return internalErrorResponse(
      "POST /api/v1/account-claims/[token]/accept: lookup failed",
      err,
    );
  }
  if (!claim) return respond("NOT_FOUND", "This link isn't valid.", 404);
  if (claim.state !== "pending") {
    return respond("CLAIM_CLOSED", CLOSED_MESSAGES[claim.state], 410);
  }

  let body: { password?: unknown; accept_terms?: unknown };
  try {
    body = await request.json();
  } catch {
    return respond("INVALID_JSON", "Invalid JSON body", 400);
  }

  if (body?.accept_terms !== true) {
    return respond(
      "VALIDATION_ERROR",
      "You must accept the Terms of Service and Privacy Policy",
      400,
    );
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!Object.values(checkPasswordRequirements(password)).every(Boolean)) {
    return respond(
      "VALIDATION_ERROR",
      "Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol",
      400,
    );
  }

  const { data: registered, error: lookupError } = await supabaseAdmin.rpc(
    "email_registered",
    { p_email: claim.email },
  );
  if (lookupError) {
    return internalErrorResponse(
      "POST /api/v1/account-claims/[token]/accept: email check failed",
      lookupError,
    );
  }
  if (registered === true) {
    return respond("EMAIL_TAKEN", EMAIL_TAKEN_MESSAGE, 409);
  }

  const { error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: claim.email,
    password,
    email_confirm: true,
    user_metadata: {
      claim_token_hash: claim.tokenHash,
      terms_version: TERMS_VERSION,
      first_name: claim.playerFirstName,
      last_name: claim.playerLastName,
    },
  });
  if (authError) {
    if (
      authError.code === "email_exists" ||
      authError.message?.toLowerCase().includes("already registered")
    ) {
      return respond("EMAIL_TAKEN", EMAIL_TAKEN_MESSAGE, 409);
    }
    return accountClaimErrorResponse(authError, "accepting a handover");
  }

  return NextResponse.json({ data: { email: claim.email } }, { status: 200 });
}

export const POST = withAuditContext("account.claim.accept", handlePost);
