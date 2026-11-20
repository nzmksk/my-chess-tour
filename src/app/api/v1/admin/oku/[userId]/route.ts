import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { notifyOkuReviewed } from "@/services/oku/notify";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { afterResponse } from "@/lib/http/after-response";
import { withAuditContext } from "@/services/supabase/audit-context";

// Reviewing emails the player, and email templates are read from disk.
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function checkAdminAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const claims = await getAuthClaims();
  if (!claims) return { user: null, isAdmin: false, error: null };

  const { data: isAdmin, error } = await supabase.rpc("has_global_permission", {
    p_user_id: claims.id,
    p_permission: "platform.manage",
  });

  return { user: claims, isAdmin: !!isAdmin, error };
}

async function handlePatch(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const { userId } = await params;

  if (!UUID_RE.test(userId)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid user ID" } },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    user,
    isAdmin,
    error: permissionError,
  } = await checkAdminAccess(supabase);

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }
  if (permissionError) {
    return internalErrorResponse(
      "PATCH /api/v1/admin/oku/[userId]: permissionError",
      permissionError,
    );
  }
  if (!isAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 },
    );
  }

  let body: { action?: string; rejection_reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  const { action, rejection_reason } = body;
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "action must be 'approve' or 'reject'",
        },
      },
      { status: 400 },
    );
  }
  if (
    action === "reject" &&
    (typeof rejection_reason !== "string" || !rejection_reason.trim())
  ) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "rejection_reason must be a non-empty string when rejecting",
        },
      },
      { status: 400 },
    );
  }

  // Guard on the row still being 'pending' so two admins can't double-review.
  const { data, error } = await supabaseAdmin
    .from("player_profiles")
    .update({
      oku_status: action === "approve" ? "verified" : "rejected",
      oku_reviewed_by: user.id,
      oku_reviewed_at: new Date().toISOString(),
      oku_rejection_reason:
        action === "reject" ? rejection_reason!.trim() : null,
    })
    .eq("user_id", userId)
    .eq("oku_status", "pending")
    .select("user_id, oku_status")
    .maybeSingle();

  if (error) {
    return internalErrorResponse(
      "PATCH /api/v1/admin/oku/[userId]: error",
      error,
    );
  }
  if (!data) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "No pending OKU submission for this user",
        },
      },
      { status: 404 },
    );
  }

  // The review is saved. Emailed after the response; best-effort, never throws.
  afterResponse(() => notifyOkuReviewed(userId));

  return NextResponse.json({ data }, { status: 200 });
}

export const PATCH = withAuditContext("admin.oku.review", handlePatch);
