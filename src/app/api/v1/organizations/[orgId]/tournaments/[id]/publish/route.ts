import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { ensureUniqueSlug, slugify } from "@/lib/slugs";
import {
  PURGE_PROFILE,
  TOURNAMENTS_LIST_TAG,
  tournamentTag,
} from "@/lib/cache-tags";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLACEHOLDER_DATE = "2099-12-31";
const PLACEHOLDER_DEADLINE = "2099-12-30T23:59:59Z";

interface TournamentRow {
  id: string;
  organization_id: string;
  slug: string | null;
  name: string;
  venue_name: string;
  venue_state: string;
  venue_address: string;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  format: { type?: string; system?: string; rounds?: number } | null;
  time_control: { base_minutes?: number } | null;
  entry_fees: { standard?: { amount_cents?: number } } | null;
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
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: orgError.message } },
      { status: 500 },
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
      "id, organization_id, slug, name, venue_name, venue_state, venue_address, start_date, end_date, registration_deadline, format, time_control, entry_fees, status",
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
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: tournamentError.message } },
      { status: 500 },
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

  const validationErrors: string[] = [];
  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toISOString();

  if (!t.name?.trim()) {
    validationErrors.push("Tournament name is required");
  }
  if (!t.venue_name?.trim()) {
    validationErrors.push("Venue name is required");
  }
  if (!t.venue_state?.trim()) {
    validationErrors.push("Venue state is required");
  }
  if (!t.venue_address?.trim()) {
    validationErrors.push("Venue address is required");
  }

  if (
    !t.start_date ||
    t.start_date === PLACEHOLDER_DATE ||
    t.start_date <= today
  ) {
    validationErrors.push("Start date must be a future date");
  }
  if (!t.end_date || t.end_date === PLACEHOLDER_DATE) {
    validationErrors.push("End date is required");
  }
  if (
    !t.registration_deadline ||
    t.registration_deadline === PLACEHOLDER_DEADLINE ||
    t.registration_deadline <= now
  ) {
    validationErrors.push("Registration deadline must be a future date");
  }

  const fmt = t.format;
  if (!fmt?.type?.trim()) {
    validationErrors.push("Tournament format type is required");
  }
  if (!fmt?.system?.trim()) {
    validationErrors.push("Tournament system is required");
  }
  if (!fmt?.rounds || fmt.rounds < 1) {
    validationErrors.push("Number of rounds must be at least 1");
  }

  const tc = t.time_control;
  if (!tc?.base_minutes || tc.base_minutes < 1) {
    validationErrors.push("Time control base time is required");
  }

  if (!t.entry_fees?.standard) {
    validationErrors.push("Standard entry fee is required");
  }

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
      status: "published",
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
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: updateError.message } },
      { status: 500 },
    );
  }

  // A newly published tournament enters the public list and gains a detail page;
  // bust both caches so it appears without waiting for the 1-day fallback.
  revalidateTag(TOURNAMENTS_LIST_TAG, PURGE_PROFILE);
  revalidateTag(tournamentTag(slug), PURGE_PROFILE);

  return NextResponse.json({ data: updated }, { status: 200 });
}
