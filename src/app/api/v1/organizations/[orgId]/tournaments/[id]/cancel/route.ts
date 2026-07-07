import { supabaseAdmin } from "@/services/supabase/admin";
import { authorizeTournamentManager } from "../_lib/authorize";
import { NextRequest, NextResponse } from "next/server";

interface CancelBody {
  reason?: unknown;
}

// Files a request to cancel a PUBLISHED tournament. This does NOT cancel the
// tournament immediately — it creates a pending cancellation request for a
// platform admin to review. The tournament only becomes 'cancelled' (and player
// refunds are initiated, wired up later) once an admin approves the request via
// review_tournament_cancellation().
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeTournamentManager(orgId, id, "cancel tournaments");
  if (!auth.ok) return auth.response;

  let body: CancelBody;
  try {
    body = (await request.json()) as CancelBody;
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "A cancellation reason is required",
        },
      },
      { status: 400 },
    );
  }

  const { data: tournament, error: tErr } = await supabaseAdmin
    .from("tournaments")
    .select("id, status")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (tErr) {
    if (tErr.code === "PGRST116") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Tournament not found" } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: tErr.message } },
      { status: 500 },
    );
  }

  if (tournament.status !== "published") {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message: "Only published tournaments can be cancelled",
        },
      },
      { status: 409 },
    );
  }

  const { data: created, error: insertError } = await supabaseAdmin
    .from("tournament_cancellation_requests")
    .insert({
      tournament_id: id,
      requested_by: auth.userId,
      reason,
    })
    .select("id, tournament_id, status, reason, created_at")
    .single();

  if (insertError) {
    // Partial unique index (one pending request per tournament) → 23505.
    if (insertError.code === "23505") {
      return NextResponse.json(
        {
          error: {
            code: "CONFLICT",
            message:
              "A cancellation request for this tournament is already pending review",
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: insertError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: created }, { status: 201 });
}
