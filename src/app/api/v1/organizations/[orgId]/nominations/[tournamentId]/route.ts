import { supabaseAdmin } from "@/services/supabase/admin";
import { authorizeOrgPermission, UUID_RE } from "@/app/api/v1/organizations/_lib/authorize-org";
import { nominationErrorResponse } from "@/app/api/v1/organizations/_lib/nomination-errors";
import {
  BENEFICIARY_LOCK_COLUMNS,
  beneficiaryLockResponse,
} from "@/app/api/v1/organizations/_lib/beneficiary-lock";
import { notifyNominationResponded } from "@/services/payouts/notify";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { afterResponse } from "@/lib/http/after-response";

// Responding emails the organizer, and email templates are read from disk.
export const runtime = "nodejs";

type Params = { params: Promise<{ orgId: string; tournamentId: string }> };

/**
 * The shared front half of accepting and declining: the caller must hold
 * payout.request on this organization, the tournament must nominate it, and
 * the beneficiary must still be changeable.
 *
 * Both are refused once the tournament starts. Accepting moves the payout and
 * declining clears the nomination, so each changes the beneficiary, which the
 * edit policy locks from the start date (src/lib/tournaments/edit-policy.ts).
 * That is the same answer the paid-fields trigger already gives for both once
 * a player has paid, and it means a nomination can't take effect after the
 * event.
 *
 * Returns the acting user, or the response to send.
 */
async function authorizeNominee(
  orgId: string,
  tournamentId: string,
  action: string,
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const auth = await authorizeOrgPermission(orgId, "payout.request");
  if (!auth.ok) return auth;

  if (!UUID_RE.test(tournamentId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid tournament ID" } },
        { status: 400 },
      ),
    };
  }

  // The RPCs check the permission against the org the tournament actually names,
  // which may not be the one in this URL.
  const { data: nominated, error: lookupError } = await supabaseAdmin
    .from("tournaments")
    .select(`id, ${BENEFICIARY_LOCK_COLUMNS}`)
    .eq("id", tournamentId)
    .eq("beneficiary_organization_id", orgId)
    .maybeSingle();

  if (lookupError) {
    return {
      ok: false,
      response: internalErrorResponse(
        `Payout nomination: failed to look up tournament ${tournamentId} (${action})`,
        lookupError,
      ),
    };
  }
  if (!nominated) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Nomination not found" } },
        { status: 404 },
      ),
    };
  }

  const locked = beneficiaryLockResponse(nominated);
  if (locked) return { ok: false, response: locked };

  return { ok: true, userId: auth.userId };
}

/**
 * Accepts a payout nomination on behalf of this organization. From this point the
 * tournament's payout comes here, unless the nomination is frozen first by a player
 * paying.
 */
export async function POST(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { orgId, tournamentId } = await params;

  const auth = await authorizeNominee(orgId, tournamentId, "accept");
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin.rpc("accept_payout_nomination", {
    p_tournament_id: tournamentId,
    p_user_id: auth.userId,
  });

  if (error) {
    return nominationErrorResponse(error, `accepting the nomination for tournament ${tournamentId}`);
  }

  // A repeated accept (double-click, retry) changes nothing, so it tells no one.
  if (!(data as { already_accepted?: boolean } | null)?.already_accepted) {
    afterResponse(() => notifyNominationResponded(tournamentId, orgId, true));
  }

  return NextResponse.json({ data }, { status: 200 });
}

/**
 * Declines a pending payout nomination on behalf of this organization. The
 * nomination is cleared and the payout stays with the organizing organization.
 * An accepted nomination can't be declined here: only the organizer can withdraw it.
 */
export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { orgId, tournamentId } = await params;

  const auth = await authorizeNominee(orgId, tournamentId, "decline");
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin.rpc("decline_payout_nomination", {
    p_tournament_id: tournamentId,
    p_user_id: auth.userId,
  });

  if (error) {
    return nominationErrorResponse(error, `declining the nomination for tournament ${tournamentId}`);
  }

  afterResponse(() => notifyNominationResponded(tournamentId, orgId, false));

  return NextResponse.json({ data }, { status: 200 });
}
