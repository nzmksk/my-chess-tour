import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import {
  PURGE_PROFILE,
  TOURNAMENTS_LIST_TAG,
  tournamentTag,
} from "@/lib/cache-tags";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function checkAdminAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const claims = await getAuthClaims();
  if (!claims) {
    return { user: null, isAdmin: false, error: null };
  }
  const { data: isAdmin, error } = await supabase.rpc("has_global_permission", {
    p_user_id: claims.id,
    p_permission: "platform.manage",
  });
  return { user: claims, isAdmin: !!isAdmin, error };
}

// Admin approves/rejects an organizer's tournament cancellation request.
// Approve flips the tournament to 'cancelled' atomically (via the RPC); refunds
// to registered players are initiated separately (wired up later).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request ID" } },
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
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: permissionError.message } },
      { status: 500 },
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

  const { data, error } = await supabaseAdmin.rpc(
    "review_tournament_cancellation",
    {
      p_request_id: id,
      p_reviewer_id: user.id,
      p_action: action,
      p_rejection_reason:
        action === "reject" ? rejection_reason!.trim() : null,
    },
  );

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json(
        {
          error: { code: "NOT_FOUND", message: "Cancellation request not found" },
        },
        { status: 404 },
      );
    }
    if (error.code === "P0001") {
      return NextResponse.json(
        {
          error: {
            code: "CONFLICT",
            message: "This cancellation request has already been reviewed",
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

  // On approval the tournament left the public 'published' listing; drop it from
  // the caches so it disappears from the browse list and its detail page.
  if (action === "approve") {
    const { data: t } = await supabaseAdmin
      .from("tournaments")
      .select("slug")
      .eq("id", (data as { tournament_id: string }).tournament_id)
      .single();
    revalidateTag(TOURNAMENTS_LIST_TAG, PURGE_PROFILE);
    if (t?.slug) revalidateTag(tournamentTag(t.slug), PURGE_PROFILE);
  }

  return NextResponse.json({ data }, { status: 200 });
}
