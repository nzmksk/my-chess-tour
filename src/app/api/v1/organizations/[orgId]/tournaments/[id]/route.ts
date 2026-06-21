import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  if (!UUID_RE.test(orgId)) {
    return NextResponse.json(
      {
        error: { code: "VALIDATION_ERROR", message: "Invalid organization ID" },
      },
      { status: 400 },
    );
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid tournament ID" } },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const permissionError = await resolvePermission(orgId, user.id);
  if (permissionError) return permissionError;

  const { data: tournament, error: tErr } = await supabaseAdmin
    .from("tournaments")
    .select(
      "id, name, description, status, start_date, end_date, registration_deadline, venue_name, venue_state, venue_address, format, time_control, is_fide_rated, is_mcf_rated, max_participants, entry_fees, prizes, restrictions",
    )
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

  const { data: regs, error: regErr } = await supabaseAdmin
    .from("registrations")
    .select("id, user_id, fee_tier, status, registered_at")
    .eq("tournament_id", id)
    .in("status", ["confirmed", "pending_payment"])
    .order("registered_at", { ascending: true });

  if (regErr) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: regErr.message } },
      { status: 500 },
    );
  }

  const registrations = (regs ?? []) as Array<{
    id: string;
    user_id: string;
    fee_tier: string;
    status: string;
    registered_at: string;
  }>;

  const userIds = registrations.map((r) => r.user_id).filter(Boolean);

  type UserRow = { id: string; first_name: string; last_name: string };
  type ProfileRow = {
    user_id: string;
    fide_id: number | null;
    fide_rating: Record<string, number> | null;
    national_rating: number | null;
  };

  let userMap = new Map<string, UserRow>();
  let profileMap = new Map<string, ProfileRow>();

  if (userIds.length > 0) {
    const [{ data: users }, { data: profiles }] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, first_name, last_name")
        .in("id", userIds),
      supabaseAdmin
        .from("player_profiles")
        .select("user_id, fide_id, fide_rating, national_rating")
        .in("user_id", userIds),
    ]);

    userMap = new Map(((users as UserRow[]) ?? []).map((u) => [u.id, u]));
    profileMap = new Map(
      ((profiles as ProfileRow[]) ?? []).map((p) => [p.user_id, p]),
    );
  }

  const formatType =
    (tournament.format as { type?: string } | null)?.type ?? "";

  const participants = registrations.map((reg, idx) => {
    const u = userMap.get(reg.user_id);
    const p = profileMap.get(reg.user_id);

    let rating: number | null = null;
    if (p?.fide_rating) {
      const r = p.fide_rating;
      if (formatType === "blitz") {
        rating = r.blitz ?? r.rapid ?? r.standard ?? null;
      } else if (formatType === "rapid") {
        rating = r.rapid ?? r.standard ?? null;
      } else {
        rating = r.standard ?? null;
      }
    }

    return {
      index: idx + 1,
      id: reg.id,
      user_id: reg.user_id,
      name: u ? `${u.first_name} ${u.last_name}` : "Unknown",
      fide_id: p?.fide_id ?? null,
      rating,
      fee_tier: reg.fee_tier,
      status: reg.status,
      registered_at: reg.registered_at,
    };
  });

  const total = registrations.length;
  const confirmed = registrations.filter(
    (r) => r.status === "confirmed",
  ).length;
  const pending = registrations.filter(
    (r) => r.status === "pending_payment",
  ).length;

  return NextResponse.json({
    data: {
      tournament: {
        id: tournament.id,
        name: tournament.name,
        description: tournament.description ?? null,
        status: tournament.status,
        start_date: tournament.start_date,
        end_date: tournament.end_date,
        registration_deadline: tournament.registration_deadline,
        venue: {
          name: tournament.venue_name,
          state: tournament.venue_state,
          address: tournament.venue_address,
        },
        format: tournament.format,
        time_control: tournament.time_control,
        is_fide_rated: tournament.is_fide_rated,
        is_mcf_rated: tournament.is_mcf_rated,
        max_participants: tournament.max_participants,
        entry_fees: tournament.entry_fees,
        prizes: tournament.prizes ?? null,
        restrictions: tournament.restrictions ?? null,
      },
      stats: { total, confirmed, pending },
      participants,
    },
  });
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
  value: string;
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
    .select("id, approval_status, created_by")
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

  if (org.created_by === userId) return null;

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const permissionError = await resolvePermission(orgId, user.id);
  if (permissionError) return permissionError;

  const { error: tournamentError } = await supabaseAdmin
    .from("tournaments")
    .select("id")
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
    patch.registration_deadline =
      typeof body.registration_deadline === "string" &&
      body.registration_deadline
        ? body.registration_deadline
        : null;
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

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("tournaments")
    .update(patch)
    .eq("id", id)
    .select("id, name, status, updated_at")
    .single();

  if (updateError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: updateError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: updated }, { status: 200 });
}
