import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

type ApprovalStatus = "pending" | "approved" | "rejected";

type ApplicationRow = {
  id: string;
  name: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const supabase = await createClient();
  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: claims.id, p_permission: "platform.manage" },
  );

  if (permissionError) {
    return internalErrorResponse(
      "GET /api/v1/admin/applications: permissionError",
      permissionError,
    );
  }

  if (!isAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select(
      "id, name, description, email, phone, approval_status, rejection_reason, created_at, reviewed_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return internalErrorResponse(
      "GET /api/v1/admin/applications: error",
      error,
    );
  }

  const applications = (data ?? []) as ApplicationRow[];

  const counts = {
    pending: applications.filter((a) => a.approval_status === "pending").length,
    approved: applications.filter((a) => a.approval_status === "approved").length,
    rejected: applications.filter((a) => a.approval_status === "rejected").length,
    total: applications.length,
  };

  return NextResponse.json(
    {
      data: {
        counts,
        applications,
      },
    },
    { status: 200 },
  );
}
