import { supabaseAdmin } from "@/services/supabase/admin";
import { authorizeTournamentManager } from "../_lib/authorize";
import {
  PURGE_PROFILE,
  TOURNAMENTS_LIST_TAG,
  tournamentTag,
} from "@/lib/cache-tags";
import { revalidateTag } from "next/cache";
import { registrationStatus } from "@/lib/registration-status";
import { NextRequest, NextResponse } from "next/server";

// Manually closes registration for a published tournament before its deadline.
// This is IRREVERSIBLE — there is no re-open action; once closed, the only way
// registration reopens is by editing the tournament back to a draft (which it
// cannot be once published). The organizer is warned of this in the UI.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeTournamentManager(orgId, id, "close registration");
  if (!auth.ok) return auth.response;

  const { data: tournament, error: tErr } = await supabaseAdmin
    .from("tournaments")
    .select("id, slug, status, registration_deadline, registration_closed_at")
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
          message: "Only published tournaments can have registration closed",
        },
      },
      { status: 409 },
    );
  }

  // registration_closed_at is the effective close time (defaulted to the
  // deadline at publish), so a non-null value no longer means "closed early".
  // Early-close is only possible while registration is still open and the close
  // time still tracks the deadline (not already moved earlier).
  const { isClosed, closedEarly } = registrationStatus(
    tournament.registration_closed_at,
    tournament.registration_deadline,
  );

  if (isClosed || closedEarly) {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message: "Registration is already closed",
        },
      },
      { status: 409 },
    );
  }

  const closedAt = new Date().toISOString();

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("tournaments")
    .update({ registration_closed_at: closedAt })
    .eq("id", id)
    .select("id, slug, status, registration_closed_at")
    .single();

  if (updateError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: updateError.message } },
      { status: 500 },
    );
  }

  // The public detail page's register CTA keys off registration_closed_at, so
  // bust both the list and detail caches for the new closed state to show.
  revalidateTag(TOURNAMENTS_LIST_TAG, PURGE_PROFILE);
  if (updated.slug) revalidateTag(tournamentTag(updated.slug), PURGE_PROFILE);

  return NextResponse.json({ data: updated }, { status: 200 });
}
