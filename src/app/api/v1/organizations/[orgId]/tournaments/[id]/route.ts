import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { getTournamentManageData } from "@/app/my/organizations/[orgId]/tournaments/[id]/_data/getTournamentManageData";
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
  EDITABLE_FIELDS,
  isChangeAllowed,
  lockReason,
  needsPaymentCheck,
  resolveEditStage,
  type EditableField,
  type EditStage,
} from "@/lib/tournaments/edit-policy";
import {
  validatePublishable,
  type PublishableTournament,
} from "@/lib/tournaments/publish-validation";
import {
  DEFAULT_COUNTRY_CODE,
  findCountry,
  isValidRegion,
  timeZoneForRegion,
} from "@/lib/tournaments/venues";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

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
  // No `timezone`: it is derived from venue_country + venue_state, not accepted.
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
    return internalErrorResponse(
      "GET /api/v1/organizations/[orgId]/tournaments/[id]: orgError",
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

interface ExistingTournament extends PublishableTournament {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  registration_closed_at: string | null;
  timezone: string;
  venue_country: string | null;
  venue_state: string | null;
  [column: string]: unknown;
}

/**
 * Deep structural equality, used to answer "is this field actually changing?"
 * the same way the database does.
 *
 * The trigger compares with `IS DISTINCT FROM`, which on jsonb is semantic:
 * key order doesn't matter, but a key being present-vs-absent does. This walks
 * objects and arrays to match that, rather than comparing JSON.stringify output
 * — two equal jsonb values can serialise to different strings purely by key
 * order, and that would resurrect the false 409 this exists to prevent.
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Postgres has one null; a column read back as null and a patch that omits a
  // value to `undefined` mean the same thing here.
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => deepEquals(item, b[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(bObj, k) &&
      deepEquals(aObj[k], bObj[k]),
  );
}

/**
 * The fields this patch actually changes. Changed, not merely present: the
 * edit wizard can send a field at its current value, and gating on presence
 * would refuse that edit while the trigger — which compares OLD/NEW — would
 * have allowed it. Presence is the client's business; what the row ends up
 * holding is the rule.
 */
function changedFields(
  existing: ExistingTournament,
  patch: Record<string, unknown>,
): EditableField[] {
  return EDITABLE_FIELDS.filter((f) => {
    if (!(f in patch)) return false;
    // An instant: the client sends `...Z`, the column reads back `...+00:00`.
    if (f === "registration_deadline") {
      const next = patch[f] as string | null;
      return (
        next == null ||
        new Date(next).getTime() !==
          new Date(existing.registration_deadline).getTime()
      );
    }
    return !deepEquals(patch[f], existing[f]);
  });
}

/**
 * Refuses a change to a field the edit policy has locked, and a decrease to
 * one it has made increase-only (capacity, once someone has paid). Which
 * fields lock when, and why, is in src/lib/tournaments/edit-policy.ts.
 *
 * The paid-registration stage is also enforced by guard_tournament_paid_fields
 * in 003_functions_triggers.sql; the DB is the authority and this is the
 * readable error. The date stages live here only.
 *
 * Returns a 409 response when the edit is refused, else null.
 */
async function checkEditFreeze(
  tournamentId: string,
  existing: ExistingTournament,
  patch: Record<string, unknown>,
  changed: EditableField[],
): Promise<NextResponse | null> {
  if (changed.length === 0) return null;

  const allowedAt = (stage: EditStage) => (f: EditableField) =>
    isChangeAllowed(f, stage, existing[f], patch[f]);

  let stage = resolveEditStage({
    status: existing.status,
    startDate: existing.start_date,
    endDate: existing.end_date,
    today: getTodayInTimeZone(resolveTimeZone(existing.timezone)),
    hasPaidRegistration: false,
  });

  // Only worth a query when the dates haven't already decided, and when the
  // patch makes a change a payment would refuse (raising capacity isn't one).
  if (needsPaymentCheck(stage) && !changed.every(allowedAt("paid"))) {
    // `head: true` — we only need to know whether one exists.
    const { count, error } = await supabaseAdmin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId)
      .eq("type", "registration")
      .eq("status", "paid")
      .limit(1);

    if (error) {
      return internalErrorResponse(
        "PATCH /api/v1/organizations/[orgId]/tournaments/[id]: payments",
        error,
      );
    }
    if ((count ?? 0) > 0) stage = "paid";
  }

  const refused = changed.filter((f) => !allowedAt(stage)(f));
  if (refused.length === 0) return null;

  return NextResponse.json(
    {
      error: {
        code: "CONFLICT",
        message: lockReason(stage),
        // The organizer needs to know WHICH fields were refused.
        details: refused,
      },
    },
    { status: 409 },
  );
}

/**
 * A published tournament has to stay publishable: an edit may not blank a
 * required field or move a date into the past. Only problems the edit
 * introduces are reported, so a listing published before a rule existed
 * (prize funding, say) can still have its description fixed without first
 * being brought up to date.
 *
 * Returns a 422 response listing what the edit broke, else null.
 */
function checkStillPublishable(
  existing: ExistingTournament,
  patch: Record<string, unknown>,
  changed: EditableField[],
): NextResponse | null {
  if (existing.status !== "published") return null;

  const merged = { ...existing, ...patch } as ExistingTournament;
  const options = {
    today: getTodayInTimeZone(resolveTimeZone(merged.timezone)),
    now: new Date().toISOString(),
    // A date that has already passed and isn't changing (a closed
    // registration) is not something this edit did.
    requireFutureStartDate: changed.includes("start_date"),
    requireFutureDeadline: changed.includes("registration_deadline"),
  };
  const before = new Set(validatePublishable(existing, options));
  const introduced = validatePublishable(merged, options).filter(
    (e) => !before.has(e),
  );
  if (introduced.length === 0) return null;

  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: introduced[0],
        details: introduced,
      },
    },
    { status: 422 },
  );
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
      // Every editable column: checkEditFreeze refuses an edit only when a
      // locked value actually changes, and checkStillPublishable validates the
      // row as it will be after the patch, so both need the current values.
      // venue_country/venue_state are also needed because the timezone is
      // derived from the pair, and a patch may only carry one half of it.
      "id, status, name, description, venue_name, venue_address, venue_state, venue_country, timezone, start_date, end_date, registration_deadline, registration_closed_at, format, time_control, is_fide_rated, is_mcf_rated, restrictions, entry_fees, prizes, max_participants, commission_rate, organizer_commission_pct",
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
      "PATCH /api/v1/organizations/[orgId]/tournaments/[id]: tournamentError",
      tournamentError,
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

  // Moving the venue moves the timezone with it, so the two are resolved
  // together. A patch may carry only one of them — the stored value stands in
  // for the other, because the row's zone has to stay consistent with wherever
  // the venue ends up, not with whichever half the client happened to send.
  if ("venue_country" in body || "venue_state" in body) {
    const country =
      (patch.venue_country as string | undefined) ??
      existing.venue_country ??
      DEFAULT_COUNTRY_CODE;
    const state =
      (patch.venue_state as string | undefined) ?? existing.venue_state ?? "";

    // An empty state is a draft the organizer hasn't finished; publish catches
    // that. A state set to something the country doesn't have would silently
    // pick the wrong zone, so it is refused.
    if (state && !isValidRegion(country, state)) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `"${state}" is not a state of the selected country`,
          },
        },
        { status: 400 },
      );
    }

    patch.timezone = timeZoneForRegion(country, state);
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

  const tournament = existing as ExistingTournament;
  const changed = changedFields(tournament, patch);

  const freezeError = await checkEditFreeze(id, tournament, patch, changed);
  if (freezeError) return freezeError;

  const publishableError = checkStillPublishable(tournament, patch, changed);
  if (publishableError) return publishableError;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("tournaments")
    .update(patch)
    .eq("id", id)
    .select("id, slug, name, status, updated_at")
    .single();

  if (updateError) {
    return internalErrorResponse(
      "PATCH /api/v1/organizations/[orgId]/tournaments/[id]: updateError",
      updateError,
    );
  }

  // Edited details are visible on the detail page and the list (name, venue,
  // dates); bust both so changes show immediately. A draft has no slug yet, so
  // only the detail tag is skippable when slug is null.
  revalidateTag(TOURNAMENTS_LIST_TAG, PURGE_PROFILE);
  if (updated.slug) revalidateTag(tournamentTag(updated.slug), PURGE_PROFILE);

  return NextResponse.json({ data: updated }, { status: 200 });
}
