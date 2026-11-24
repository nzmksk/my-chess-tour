import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { withAuditContext } from "@/services/supabase/audit-context";
import { TERMS_VERSION } from "@/lib/reference/legal";
import {
  INVITATION_TOKEN_RE,
  hashInvitationToken,
} from "@/services/organizations/invitations";
import { helperErrorResponse } from "@/services/guardianship/helpers";

type Params = { params: Promise<{ token: string }> };

async function handlePost(
  request: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  const { token } = await params;

  if (!INVITATION_TOKEN_RE.test(token)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Invitation not found" } },
      { status: 404 },
    );
  }

  const claims = await getAuthClaims();
  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  let body: { accept_terms?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (body?.accept_terms !== true) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            "accept_terms must be true: confirm you'll act for this player under the Terms",
        },
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin.rpc("accept_helper_invitation", {
    p_token_hash: hashInvitationToken(token),
    p_helper_user_id: claims.id,
    p_terms_version: TERMS_VERSION,
  });
  if (error) return helperErrorResponse(error, "accepting a helper invitation");

  return NextResponse.json({ data }, { status: 200 });
}

export const POST = withAuditContext("helper.accept", handlePost);
