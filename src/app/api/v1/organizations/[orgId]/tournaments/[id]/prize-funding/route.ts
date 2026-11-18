import { supabaseAdmin } from "@/services/supabase/admin";
import {
  authorizeOrgPermission,
  UUID_RE,
} from "@/app/api/v1/organizations/_lib/authorize-org";
import { loadPrizePoolPosition } from "@/services/prizes/pool";
import { syncPrizeFundingRequests } from "@/services/prizes/funding-requests";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import {
  declaredFunders,
  funderKey,
  type PrizesJson,
} from "@/lib/tournaments/prize-funding";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

// The platform-managed prize pool, money in (#523). Only for a tournament whose
// prizes.distribution is "platform". Each funder named in the prizes is sent a
// CHIP Collect link for their share automatically (syncPrizeFundingRequests);
// the sponsor pays it, and the Collect webhook settles the contribution
// (settle_prize_funding). This route shows where that stands and retries it.
//
// Entry fees never fund prizes, so this is the only way money enters the pool.

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

interface FundingTournament {
  id: string;
  name: string;
  status: "draft" | "pending_funding" | "published" | "cancelled";
  prizes: PrizesJson | null;
}

async function loadTournament(
  orgId: string,
  id: string,
): Promise<{ tournament: FundingTournament } | { response: NextResponse }> {
  if (!UUID_RE.test(id)) {
    return { response: errorResponse("VALIDATION_ERROR", "Invalid tournament ID", 400) };
  }
  const { data, error } = await supabaseAdmin
    .from("tournaments")
    .select("id, name, status, prizes")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) {
    return {
      response: internalErrorResponse(
        `Prize funding: failed to load tournament ${id}`,
        error,
      ),
    };
  }
  if (!data) {
    return { response: errorResponse("NOT_FOUND", "Tournament not found", 404) };
  }
  return { tournament: data as FundingTournament };
}

/**
 * The pool's position, every contribution asked for so far (newest first,
 * superseded ones included and marked), and the funders the prizes name with
 * no address to send a link to. Readable by anyone who can see the
 * organization's payouts.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.view");
  if (!auth.ok) return auth.response;

  const loaded = await loadTournament(orgId, id);
  if ("response" in loaded) return loaded.response;
  const { tournament } = loaded;

  const pool = await loadPrizePoolPosition(id);
  if (!pool.ok) {
    return internalErrorResponse(
      `Prize funding: failed to load the pool of tournament ${id}`,
      pool.error,
    );
  }

  const [fundingsRes, contactsRes] = await Promise.all([
    supabaseAdmin
      .from("prize_fundings")
      .select(
        "id, funder_name, funder_email, amount_cents, status, checkout_url, paid_at, cancelled_at, created_at",
      )
      .eq("tournament_id", id)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("prize_funder_contacts")
      .select("funder_name")
      .eq("tournament_id", id),
  ]);
  if (fundingsRes.error || contactsRes.error) {
    return internalErrorResponse(
      `Prize funding: failed to list the fundings of tournament ${id}`,
      fundingsRes.error ?? contactsRes.error,
    );
  }

  const withContact = new Set(
    ((contactsRes.data ?? []) as { funder_name: string }[]).map((c) => funderKey(c.funder_name)),
  );
  const missingContacts =
    tournament.prizes?.distribution === "platform"
      ? declaredFunders(tournament.prizes)
          .filter((f) => !withContact.has(f.key))
          .map((f) => f.name)
      : [];

  return NextResponse.json({
    data: {
      pool: pool.position,
      status: tournament.status,
      fundings: fundingsRes.data ?? [],
      missing_contacts: missingContacts,
    },
  });
}

/**
 * Re-sends what is outstanding: reconciles the funding requests with the
 * prizes and contacts, retries any CHIP link that failed to be created, and
 * emails each funder whose link is new. Requests are created automatically
 * when the tournament is published and whenever its prizes or contacts change;
 * this is the organizer's Retry when something didn't go through. Owner only
 * (payout.request): it asks for money.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeOrgPermission(orgId, "payout.request");
  if (!auth.ok) return auth.response;

  // Retrying emails each funder whose link is new; shares a budget with
  // saving funder contacts.
  const limited = await enforceRateLimit("funderLinks", request, auth.userId);
  if (limited) return limited;

  const loaded = await loadTournament(orgId, id);
  if ("response" in loaded) return loaded.response;
  const { tournament } = loaded;

  if (tournament.prizes?.distribution !== "platform") {
    return errorResponse(
      "NOT_PLATFORM_DISTRIBUTED",
      "This tournament's winners are paid by the organizer, so there is no prize pool to fund",
      409,
    );
  }
  if (tournament.status === "cancelled") {
    return errorResponse("TOURNAMENT_CANCELLED", "This tournament has been cancelled", 409);
  }
  if (tournament.status === "draft") {
    return errorResponse(
      "NOT_PUBLISHED",
      "Payment links are sent to the sponsors when the tournament is published",
      409,
    );
  }

  const funding = await syncPrizeFundingRequests(id, auth.userId);
  if (funding.error) {
    return internalErrorResponse(
      `Prize funding: failed to reconcile the requests of tournament ${id}`,
      funding.error,
    );
  }
  if (funding.unlinked > 0) {
    return errorResponse(
      "PAYMENT_GATEWAY_ERROR",
      "Some payment links couldn't be created. Please try again shortly.",
      503,
    );
  }

  return NextResponse.json({
    data: {
      linked: funding.linked,
      missing_contacts: funding.missingContacts,
      released: funding.released,
    },
  });
}
