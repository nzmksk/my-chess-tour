import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import { withAuditContext } from "@/services/supabase/audit-context";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { isUnderAdultAge } from "@/lib/auth/adult-age";
import { sendHelperInvitationEmail } from "@/services/email/email";
import {
  generateInvitationToken,
  hashInvitationToken,
  personName,
} from "@/services/organizations/invitations";
import {
  helperErrorResponse,
  helperInvitationUrl,
  loadHelpersOverview,
} from "@/services/guardianship/helpers";
import {
  HELPER_RELATIONSHIPS,
  HELPER_RELATIONSHIP_LABELS,
  isHelperRelationship,
} from "@/lib/guardianship/helper-relationships";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
    { status: 401 },
  );
}

async function handleGet(): Promise<NextResponse> {
  const claims = await getAuthClaims();
  if (!claims) return unauthorized();

  const [accountRes, profileRes] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("account_type, auth_user_id")
      .eq("id", claims.id)
      .single(),
    supabaseAdmin
      .from("player_profiles")
      .select("date_of_birth")
      .eq("user_id", claims.id)
      .maybeSingle(),
  ]);
  const lookupError = accountRes.error ?? profileRes.error;
  if (lookupError) {
    return internalErrorResponse(
      "GET /api/v1/me/helpers: account lookup failed",
      lookupError,
    );
  }

  const dateOfBirth = profileRes.data?.date_of_birth as string | null;
  const canInvite =
    accountRes.data?.account_type === "self" &&
    accountRes.data?.auth_user_id != null &&
    !(dateOfBirth && isUnderAdultAge(dateOfBirth));

  const overview = await loadHelpersOverview(claims.id, canInvite);
  if (!overview.ok) {
    return internalErrorResponse(
      "GET /api/v1/me/helpers: load failed",
      overview.error,
    );
  }
  return NextResponse.json({ data: overview.data });
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();
  if (!claims) return unauthorized();

  const limited = await enforceRateLimit("helperInvite", request, claims.id);
  if (limited) return limited;

  let body: { email?: unknown; relationship?: unknown };
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
  const errors: string[] = [];
  if (!EMAIL_RE.test(email) || email.length > 255) {
    errors.push("email must be a valid email address");
  }
  if (!isHelperRelationship(body?.relationship)) {
    errors.push(
      `relationship must be one of: ${HELPER_RELATIONSHIPS.join(", ")}`,
    );
  }
  if (errors.length > 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: errors.join("; ") } },
      { status: 400 },
    );
  }
  const relationship =
    body.relationship as (typeof HELPER_RELATIONSHIPS)[number];

  const token = generateInvitationToken();
  const { data, error } = await supabaseAdmin.rpc("create_helper_invitation", {
    p_player_user_id: claims.id,
    p_email: email,
    p_relationship: relationship,
    p_token_hash: hashInvitationToken(token),
  });
  if (error) return helperErrorResponse(error, "creating a helper invitation");

  const invitation = data as {
    invitation_id: string;
    email: string;
    expires_at: string;
  };

  const { data: player } = await supabaseAdmin
    .from("users")
    .select("first_name, last_name")
    .eq("id", claims.id)
    .single();

  let emailSent = true;
  try {
    await sendHelperInvitationEmail(invitation.email, {
      playerName: personName(player) ?? "A MY Chess Tour player",
      relationshipLabel: HELPER_RELATIONSHIP_LABELS[relationship],
      invitationUrl: helperInvitationUrl(token),
    });
  } catch (err) {
    emailSent = false;
    console.error(
      "POST /api/v1/me/helpers: invitation email failed for invitation",
      invitation.invitation_id,
      err,
    );
  }

  return NextResponse.json(
    {
      data: {
        id: invitation.invitation_id,
        email: invitation.email,
        relationship,
        expires_at: invitation.expires_at,
        email_sent: emailSent,
      },
    },
    { status: 201 },
  );
}

export const GET = handleGet;
export const POST = withAuditContext("helper.invite", handlePost);
