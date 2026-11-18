import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { ensureUniqueSlug, slugify } from "@/lib/tournaments/slugs";
import {
  PURGE_PROFILE,
  TOURNAMENTS_LIST_TAG,
  tournamentTag,
} from "@/lib/tournaments/cache-tags";
import {
  getTodayInTimeZone,
  resolveTimeZone,
} from "@/lib/tournaments/datetime";
import {
  needsPrizeFunding,
  type FunderContact,
  type PrizesJson,
} from "@/lib/tournaments/prize-funding";
import { validatePublishable } from "@/lib/tournaments/publish-validation";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { syncPrizeFundingRequests } from "@/services/prizes/funding-requests";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TournamentRow {
  id: string;
  organization_id: string;
  slug: string | null;
  name: string;
  venue_name: string;
  venue_state: string;
  venue_address: string;
  timezone: string;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  format: { type?: string; system?: string; rounds?: number } | null;
  time_control: { base_minutes?: number } | null;
  entry_fees: { standard?: { amount_cents?: number } } | null;
  prizes: PrizesJson | null;
  status: string;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  if (!UUID_RE.test(orgId)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid organization ID",
        },
      },
      { status: 400 },
    );
  }

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid tournament ID",
        },
      },
      { status: 400 },
    );
  }

  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id, approval_status")
    .eq("id", orgId)
    .is("deleted_at", null)
    .single();

  if (orgError) {
    if (orgError.code === "PGRST116") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        { status: 404 },
      );
    }
    return internalErrorResponse(
      "POST /api/v1/organizations/[orgId]/tournaments/[id]/publish: orgError",
      orgError,
    );
  }

  if (org.approval_status !== "approved") {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Organization is not approved",
        },
      },
      { status: 403 },
    );
  }

  const { data: membership, error: memberError } = await supabaseAdmin
    .from("organization_memberships")
    .select("roles!inner(name)")
    .eq("organization_id", orgId)
    .eq("user_id", claims.id)
    .single();

  if (memberError || !membership) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Access denied" } },
      { status: 403 },
    );
  }

  const roleName = (membership as unknown as { roles: { name: string } }).roles
    ?.name;
  if (roleName !== "owner" && roleName !== "admin") {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Admin or owner role required to publish tournaments",
        },
      },
      { status: 403 },
    );
  }

  const { data: tournament, error: tournamentError } = await supabaseAdmin
    .from("tournaments")
    .select(
      "id, organization_id, slug, name, venue_name, venue_state, venue_address, timezone, start_date, end_date, registration_deadline, format, time_control, entry_fees, prizes, status",
    )
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (tournamentError) {
    if (tournamentError.code === "PGRST116") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Tournament not found" } },
        { status: 404 },
      );
    }
    return internalErrorResponse(
      "POST /api/v1/organizations/[orgId]/tournaments/[id]/publish: tournamentError",
      tournamentError,
    );
  }

  const t = tournament as TournamentRow;

  if (t.status !== "draft") {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message: "Only draft tournaments can be published",
        },
      },
      { status: 409 },
    );
  }

  // A platform-distributed pool is collected from its funders, so publishing
  // one needs every funder's address. Prize money the organizer pays out
  // themselves needs none.
  const awaitsFunding = needsPrizeFunding(t.prizes);
  let funderContacts: FunderContact[] | undefined;
  if (awaitsFunding) {
    const { data: contacts, error: contactsError } = await supabaseAdmin
      .from("prize_funder_contacts")
      .select("funder_name, funder_email")
      .eq("tournament_id", id);
    if (contactsError) {
      return internalErrorResponse(
        "POST /api/v1/organizations/[orgId]/tournaments/[id]/publish: contactsError",
        contactsError,
      );
    }
    funderContacts = (contacts ?? []) as FunderContact[];
  }

  // A start date is a calendar date at the venue, so "still in the future" is
  // judged against the venue's today rather than the server's.
  const validationErrors = validatePublishable(t, {
    today: getTodayInTimeZone(resolveTimeZone(t.timezone)),
    now: new Date().toISOString(),
    funderContacts,
  });

  if (validationErrors.length > 0) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: validationErrors[0],
          details: validationErrors,
        },
      },
      { status: 422 },
    );
  }

  const publishedAt = new Date().toISOString();

  // Assign the public slug on first publish (drafts have none) and keep it stable
  // on any re-publish so shared links never break. Uniqueness is enforced by the
  // tournaments_slug_key index; ensureUniqueSlug appends -2/-3… on collision.
  const slug =
    t.slug ??
    (await ensureUniqueSlug(slugify(t.name), async (candidate) => {
      const { count } = await supabaseAdmin
        .from("tournaments")
        .select("id", { count: "exact", head: true })
        .eq("slug", candidate)
        .neq("id", id);
      return (count ?? 0) > 0;
    }));

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("tournaments")
    .update({
      // A platform-distributed pool must be paid in before anyone can see the
      // tournament, let alone register: it waits, unlisted, until the payment
      // that completes the pool releases it (release_funded_tournament).
      status: awaitsFunding ? "pending_funding" : "published",
      published_by: claims.id,
      published_at: publishedAt,
      slug,
      // Registration closes at the deadline by default. This is the single
      // effective close time; the organizer can later move it earlier via
      // close-registration. (t.registration_deadline is validated above.)
      registration_closed_at: t.registration_deadline,
    })
    .eq("id", id)
    .select("id, slug, status, published_at")
    .single();

  if (updateError) {
    return internalErrorResponse(
      "POST /api/v1/organizations/[orgId]/tournaments/[id]/publish: updateError",
      updateError,
    );
  }

  if (awaitsFunding) {
    // Every funder is sent a payment link for their share now. The tournament
    // is published as far as the organizer is concerned even if CHIP is
    // briefly down: a request left without a link is retried from the manage
    // page and by the daily run.
    const funding = await syncPrizeFundingRequests(id, claims.id);
    if (funding.error) {
      console.error(
        `Publish: tournament ${id} is pending funding, but its funding requests failed to reconcile`,
        funding.error.message,
      );
    }
    return NextResponse.json(
      {
        data: {
          ...updated,
          // Already funded (an edge: nothing left to collect) means listed.
          status: funding.released ? "published" : updated.status,
          funding: {
            linked: funding.linked,
            unlinked: funding.unlinked,
            missing_contacts: funding.missingContacts,
          },
        },
      },
      { status: 200 },
    );
  }

  // A newly published tournament enters the public list and gains a detail page;
  // bust both caches so it appears without waiting for the 1-day fallback.
  revalidateTag(TOURNAMENTS_LIST_TAG, PURGE_PROFILE);
  revalidateTag(tournamentTag(slug), PURGE_PROFILE);

  return NextResponse.json({ data: updated }, { status: 200 });
}
