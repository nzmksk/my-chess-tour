import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { getTournamentManageData } from "@/app/my/organizations/[orgId]/tournaments/[id]/_data/getTournamentManageData";
import {
  PURGE_PROFILE,
  TOURNAMENTS_LIST_TAG,
  tournamentTag,
} from "@/lib/cache-tags";
import { getTodayInTimeZone, resolveTimeZone } from "@/lib/datetime";
import { DEFAULT_COUNTRY_CODE, findCountry } from "@/lib/venues";
import { getTournamentDateState } from "@/app/tournaments/utils";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const result = await getTournamentManageData(orgId, id);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.status },
    );
  }

  return NextResponse.json({ data: result.data });
}

interface FormatInput {
  type?: string;
  system?: string;
  rounds?: number;
}

interface TimeControlInput {
  base_minutes?: number;
  increment_seconds?: number;
  delay_seconds?: number;
}

interface EntryFeesInput {
  standard?: { amount_cents?: number };
  additional?: unknown[];
}

interface Restriction {
  type: string;
  value?: string;
  min?: number | null;
  max?: number | null;
}

interface PrizesInput {
  categories?: unknown[];
  special?: unknown[];
}

interface UpdateTournamentBody {
  name?: unknown;
  description?: unknown;
  venue_name?: unknown;
  venue_state?: unknown;
  venue_address?: unknown;
  venue_country?: unknown;
  timezone?: unknown;
  format?: FormatInput;
  time_control?: TimeControlInput;
  start_date?: unknown;
  end_date?: unknown;
  registration_deadline?: unknown;
  max_participants?: unknown;
  is_fide_rated?: unknown;
  is_mcf_rated?: unknown;
  entry_fees?: EntryFeesInput;
  prizes?: PrizesInput;
  restrictions?: Restriction[];
}

async function resolvePermission(
  orgId: string,
  userId: string,
): Promise<NextResponse | null> {
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
    .eq("user_id", userId)
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
          message: "Admin or owner role required to update tournaments",
        },
      },
      { status: 403 },
    );
  }

  return null;
}

// Columns that define what a player is paying for and what they can win. Once
// somebody has paid, changing these rewrites the deal after the fact — and for
// `prizes` it also moves the payout holdback under a tournament that is already
// selling. Frozen at the first paid registration, not at publish, so an
// organizer can still correct a typo on a listing nobody has bought into yet.
const MONEY_FIELDS = [
  "entry_fees",
  "prizes",
  "max_participants",
  "commission_rate",
  "organizer_commission_pct",
] as const;

interface FreezeSubject {
  status: string;
  start_date: string;
  end_date: string;
  timezone: string;
}

/**
 * Two-stage edit freeze.
 *
 * Stage 1 — money fields lock at the first paid registration.
 * Stage 2 — everything locks once the tournament starts.
 *
 * Both rules are also enforced by a BEFORE UPDATE trigger in
 * 003_functions_triggers.sql; the DB is the authority and this is the readable
 * error. Drafts are exempt: they have placeholder dates and can't have
 * registrations, so neither stage can apply.
 *
 * Returns a 409 response when the edit is refused, else null.
 */
async function checkEditFreeze(
  tournamentId: string,
  existing: FreezeSubject,
  patch: Record<string, unknown>,
): Promise<NextResponse | null> {
  if (existing.status === "draft") return null;

  // Stage 2 first: it's the broader rule, and it needs no query.
  const dateState = getTournamentDateState(
    existing.start_date,
    existing.end_date,
    getTodayInTimeZone(existing.timezone),
  );
  if (dateState !== "upcoming") {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message:
            dateState === "ongoing"
              ? "This tournament has started and can no longer be edited"
              : "This tournament has ended and can no longer be edited",
        },
      },
      { status: 409 },
    );
  }

  const touchedMoneyFields = MONEY_FIELDS.filter((f) => f in patch);
  if (touchedMoneyFields.length === 0) return null;

  // `head: true` — we only need to know whether one exists.
  const { count, error } = await supabaseAdmin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("type", "registration")
    .eq("status", "paid")
    .limit(1);

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message:
            "Entry fees, prizes and capacity are locked once a player has paid",
          details: touchedMoneyFields,
        },
      },
      { status: 409 },
    );
  }

  return null;
}

export async function PATCH(
  request: NextRequest,
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

  const permissionError = await resolvePermission(orgId, claims.id);
  if (permissionError) return permissionError;

  const { data: existing, error: tournamentError } = await supabaseAdmin
    .from("tournaments")
    .select(
      "id, status, registration_deadline, registration_closed_at, start_date, end_date, timezone",
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

  let body: UpdateTournamentBody;
  try {
    body = (await request.json()) as UpdateTournamentBody;
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Tournament name cannot be empty",
          },
        },
        { status: 400 },
      );
    }
    patch.name = name;
  }

  if ("description" in body) {
    patch.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  }

  if ("venue_name" in body) {
    patch.venue_name =
      typeof body.venue_name === "string" ? body.venue_name.trim() : "";
  }

  if ("venue_state" in body) {
    patch.venue_state =
      typeof body.venue_state === "string" ? body.venue_state.trim() : "";
  }

  if ("venue_address" in body) {
    patch.venue_address =
      typeof body.venue_address === "string" ? body.venue_address.trim() : "";
  }

  // An unrecognised country — or a non-string one — falls back to the platform
  // default rather than erroring, matching create-route behaviour and the
  // column default. `.code` is already the canonical uppercase form.
  if ("venue_country" in body) {
    patch.venue_country =
      findCountry(body.venue_country)?.code ?? DEFAULT_COUNTRY_CODE;
  }

  // Moving the venue can move the timezone with it. Anything off the supported
  // picklist falls back to the platform default rather than storing a zone no
  // formatter can read.
  if ("timezone" in body) {
    patch.timezone = resolveTimeZone(
      typeof body.timezone === "string" ? body.timezone : null,
    );
  }

  if ("format" in body && body.format && typeof body.format === "object") {
    patch.format = {
      type: body.format.type ?? "",
      system: body.format.system ?? "",
      rounds: body.format.rounds ?? 0,
    };
  }

  if (
    "time_control" in body &&
    body.time_control &&
    typeof body.time_control === "object"
  ) {
    patch.time_control = {
      base_minutes: body.time_control.base_minutes ?? 0,
      increment_seconds: body.time_control.increment_seconds ?? 0,
      delay_seconds: body.time_control.delay_seconds ?? 0,
    };
  }

  if ("start_date" in body) {
    patch.start_date =
      typeof body.start_date === "string" && body.start_date
        ? body.start_date
        : null;
  }

  if ("end_date" in body) {
    patch.end_date =
      typeof body.end_date === "string" && body.end_date ? body.end_date : null;
  }

  if ("registration_deadline" in body) {
    const newDeadline =
      typeof body.registration_deadline === "string" &&
      body.registration_deadline
        ? body.registration_deadline
        : null;
    patch.registration_deadline = newDeadline;

    // registration_closed_at is the effective close time, defaulted to the
    // deadline at publish. When a published tournament's deadline moves, keep
    // the close time in sync — but only if it still tracks the deadline (never
    // manually closed early). If the organizer closed early
    // (closed_at < deadline), that timestamp is intentional and irreversible,
    // so leave it. Drafts (closed_at IS NULL) get their default at publish.
    if (
      newDeadline &&
      existing.status === "published" &&
      existing.registration_closed_at != null &&
      new Date(existing.registration_closed_at).getTime() ===
        new Date(existing.registration_deadline).getTime()
    ) {
      patch.registration_closed_at = newDeadline;
    }
  }

  if ("max_participants" in body) {
    patch.max_participants =
      typeof body.max_participants === "number" && body.max_participants >= 2
        ? body.max_participants
        : 2;
  }

  if ("is_fide_rated" in body) {
    patch.is_fide_rated =
      typeof body.is_fide_rated === "boolean" ? body.is_fide_rated : false;
  }

  if ("is_mcf_rated" in body) {
    patch.is_mcf_rated =
      typeof body.is_mcf_rated === "boolean" ? body.is_mcf_rated : false;
  }

  if ("entry_fees" in body && body.entry_fees) {
    const ef = body.entry_fees;
    patch.entry_fees = {
      standard: ef.standard ?? { amount_cents: 0 },
      additional: Array.isArray(ef.additional) ? ef.additional : [],
    };
  }

  if ("prizes" in body) {
    patch.prizes =
      body.prizes &&
      (Array.isArray(body.prizes.categories) ||
        Array.isArray(body.prizes.special))
        ? body.prizes
        : null;
  }

  if ("restrictions" in body) {
    patch.restrictions = Array.isArray(body.restrictions)
      ? body.restrictions
      : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "No fields provided to update",
        },
      },
      { status: 400 },
    );
  }

  const freezeError = await checkEditFreeze(id, existing, patch);
  if (freezeError) return freezeError;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("tournaments")
    .update(patch)
    .eq("id", id)
    .select("id, slug, name, status, updated_at")
    .single();

  if (updateError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: updateError.message } },
      { status: 500 },
    );
  }

  // Edited details are visible on the detail page and the list (name, venue,
  // dates); bust both so changes show immediately. A draft has no slug yet, so
  // only the detail tag is skippable when slug is null.
  revalidateTag(TOURNAMENTS_LIST_TAG, PURGE_PROFILE);
  if (updated.slug) revalidateTag(tournamentTag(updated.slug), PURGE_PROFILE);

  return NextResponse.json({ data: updated }, { status: 200 });
}
