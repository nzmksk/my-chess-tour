import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { withAuditContext } from "@/services/supabase/audit-context";
import { UUID_RE } from "@/app/api/v1/organizations/_lib/authorize-org";
import { helperErrorResponse } from "@/services/guardianship/helpers";

async function handleDelete(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const claims = await getAuthClaims();
  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Helper not found" } },
      { status: 404 },
    );
  }

  const { data, error } = await supabaseAdmin.rpc("end_helper_guardianship", {
    p_user_id: claims.id,
    p_guardianship_id: id,
  });
  if (error) return helperErrorResponse(error, "ending a helper relationship");

  const result = data as { guardianship_id: string; ended_by: string };
  return NextResponse.json({
    data: { id: result.guardianship_id, ended_by: result.ended_by },
  });
}

export const DELETE = withAuditContext("helper.end", handleDelete);
