import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import { withAuditContext } from "@/services/supabase/audit-context";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { UUID_RE } from "@/app/api/v1/organizations/_lib/authorize-org";
import { validateEmail } from "@/services/auth/auth-validation";
import { sendAccountClaimEmail } from "@/services/email/email";
import {
  generateInvitationToken,
  hashInvitationToken,
} from "@/services/organizations/invitations";
import {
  dependentNotFoundResponse,
  getDependent,
  type DependentView,
} from "@/services/guardianship/dependents";
import {
  accountClaimErrorResponse,
  accountClaimUrl,
} from "@/services/guardianship/account-claims";

type RouteContext = { params: Promise<{ id: string }> };

type Resolved =
  | { ok: true; guardianId: string; dependent: DependentView }
  | { ok: false; response: NextResponse };

async function resolve(
  context: RouteContext,
  label: string,
): Promise<Resolved> {
  const { id } = await context.params;
  const claims = await getAuthClaims();
  if (!claims) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        },
        { status: 401 },
      ),
    };
  }
  if (!UUID_RE.test(id)) {
    return { ok: false, response: dependentNotFoundResponse() };
  }
  const result = await getDependent(claims.id, id);
  if (!result.ok) {
    return {
      ok: false,
      response: internalErrorResponse(`${label}: lookup failed`, result.error),
    };
  }
  if (!result.data) return { ok: false, response: dependentNotFoundResponse() };
  return { ok: true, guardianId: claims.id, dependent: result.data };
}

async function guardianName(guardianId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("users")
    .select("first_name, last_name")
    .eq("id", guardianId)
    .maybeSingle();
  const row = data as {
    first_name: string | null;
    last_name: string | null;
  } | null;
  return (
    [row?.first_name, row?.last_name].filter(Boolean).join(" ") ||
    "Your guardian"
  );
}

async function handlePost(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const label = "POST /api/v1/me/dependents/[id]/claim";
  const resolved = await resolve(context, label);
  if (!resolved.ok) return resolved.response;
  const { guardianId, dependent } = resolved;

  const limited = await enforceRateLimit("accountClaim", request, guardianId);
  if (limited) return limited;

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!validateEmail(email) || email.length > 255) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Enter the player's own email address.",
        },
      },
      { status: 400 },
    );
  }

  const token = generateInvitationToken();
  const { data, error } = await supabaseAdmin.rpc("create_account_claim", {
    p_guardian_user_id: guardianId,
    p_dependent_user_id: dependent.id,
    p_email: email,
    p_token_hash: hashInvitationToken(token),
  });
  if (error) return accountClaimErrorResponse(error, "starting a handover");
  const claim = data as { email: string; expires_at: string };

  let emailSent = true;
  try {
    await sendAccountClaimEmail(claim.email, {
      playerName: dependent.first_name,
      guardianName: await guardianName(guardianId),
      claimUrl: accountClaimUrl(token),
    });
  } catch (err) {
    emailSent = false;
    console.error(`${label}: handover email failed`, err);
  }

  return NextResponse.json(
    {
      data: {
        email: claim.email,
        expires_at: claim.expires_at,
        email_sent: emailSent,
      },
    },
    { status: 201 },
  );
}

async function handleDelete(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const label = "DELETE /api/v1/me/dependents/[id]/claim";
  const resolved = await resolve(context, label);
  if (!resolved.ok) return resolved.response;

  const { data, error } = await supabaseAdmin.rpc("cancel_account_claim", {
    p_guardian_user_id: resolved.guardianId,
    p_dependent_user_id: resolved.dependent.id,
  });
  if (error) return accountClaimErrorResponse(error, "cancelling a handover");

  return NextResponse.json({ data: { cancelled: data === true } });
}

export const POST = withAuditContext("dependent.claim.start", handlePost);
export const DELETE = withAuditContext("dependent.claim.cancel", handleDelete);
