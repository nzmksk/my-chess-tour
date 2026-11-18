import { supabaseAdmin } from "@/services/supabase/admin";
import {
  authorizeOrgPermission,
  UUID_RE,
} from "@/app/api/v1/organizations/_lib/authorize-org";
import {
  FUNDER_EMAIL_RE,
  funderKey,
  type FunderContact,
} from "@/lib/tournaments/prize-funding";
import { syncPrizeFundingRequests } from "@/services/prizes/funding-requests";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

// Where each prize funder's payment link is sent (#523). Separate from the
// tournament body on purpose: tournaments.prizes is publicly readable once the
// tournament is listed, and a sponsor's address is not, so it lives in
// prize_funder_contacts and is read and written only here.
//
// Saving contacts for a tournament that is already asking for money (pending
// funding, or listed with a top-up outstanding) re-runs the funding requests,
// so a funder who just got an address is sent their link, and one whose address
// changed gets a fresh link at the new one.

const MAX_CONTACTS = 50;

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

async function loadTournament(
  orgId: string,
  id: string,
): Promise<{ status: string } | NextResponse> {
  if (!UUID_RE.test(id)) {
    return errorResponse("VALIDATION_ERROR", "Invalid tournament ID", 400);
  }
  const { data, error } = await supabaseAdmin
    .from("tournaments")
    .select("status")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) {
    return internalErrorResponse(`Funder contacts: failed to load tournament ${id}`, error);
  }
  if (!data) return errorResponse("NOT_FOUND", "Tournament not found", 404);
  return data as { status: string };
}

/** The tournament's funder contacts, for the edit wizard. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeOrgPermission(orgId, "tournament.view");
  if (!auth.ok) return auth.response;

  const tournament = await loadTournament(orgId, id);
  if (tournament instanceof NextResponse) return tournament;

  const { data, error } = await supabaseAdmin
    .from("prize_funder_contacts")
    .select("funder_name, funder_email")
    .eq("tournament_id", id)
    .order("funder_name");
  if (error) {
    return internalErrorResponse(`Funder contacts: failed to list for tournament ${id}`, error);
  }
  return NextResponse.json({ data: data ?? [] });
}

function parseContacts(body: unknown): FunderContact[] | string {
  const raw = (body as { contacts?: unknown } | null)?.contacts;
  if (!Array.isArray(raw)) return "contacts must be a list";
  if (raw.length > MAX_CONTACTS) return `At most ${MAX_CONTACTS} funders`;

  const contacts: FunderContact[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name =
      typeof (item as { funder_name?: unknown })?.funder_name === "string"
        ? (item as { funder_name: string }).funder_name.trim()
        : "";
    const email =
      typeof (item as { funder_email?: unknown })?.funder_email === "string"
        ? (item as { funder_email: string }).funder_email.trim().toLowerCase()
        : "";
    if (!name || name.length > 255) return "Every funder needs a name";
    if (!FUNDER_EMAIL_RE.test(email) || email.length > 255) {
      return `${name}: enter a valid email address`;
    }
    const key = funderKey(name);
    if (seen.has(key)) return `${name} is listed twice`;
    seen.add(key);
    contacts.push({ funder_name: name, funder_email: email });
  }
  return contacts;
}

/**
 * Replaces the tournament's funder contacts. Body: { contacts: [{ funder_name,
 * funder_email }] }; funders left out lose their address. Editing a tournament
 * is what this is part of, so it takes tournament.edit.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const auth = await authorizeOrgPermission(orgId, "tournament.edit");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid request body", 400);
  }
  const contacts = parseContacts(body);
  if (typeof contacts === "string") {
    return errorResponse("VALIDATION_ERROR", contacts, 400);
  }

  const tournament = await loadTournament(orgId, id);
  if (tournament instanceof NextResponse) return tournament;
  if (tournament.status === "cancelled") {
    return errorResponse("TOURNAMENT_CANCELLED", "This tournament has been cancelled", 409);
  }

  // Only a tournament already asking for money emails the funders on save;
  // a draft saves contacts on every wizard step and sends nothing.
  const sendsLinks =
    tournament.status === "pending_funding" || tournament.status === "published";
  if (sendsLinks) {
    const limited = await enforceRateLimit("funderLinks", request, auth.userId);
    if (limited) return limited;
  }

  const { error } = await supabaseAdmin.rpc("set_prize_funder_contacts", {
    p_tournament_id: id,
    p_contacts: contacts,
  });
  if (error) {
    if (error.code === "P0001" && error.message.startsWith("PRIZE_FUNDER_CONTACT_INVALID")) {
      return errorResponse("VALIDATION_ERROR", "Check the funders' names and email addresses", 400);
    }
    return internalErrorResponse(`Funder contacts: failed to save for tournament ${id}`, error);
  }

  if (sendsLinks) {
    const funding = await syncPrizeFundingRequests(id, auth.userId);
    if (funding.error) {
      // The contacts are saved; the next sync (manage page, daily run) sends
      // whatever is outstanding.
      console.error(
        `Funder contacts: saved for tournament ${id}, but its funding requests failed to reconcile`,
        funding.error.message,
      );
    }
  }

  return NextResponse.json({ data: contacts });
}
