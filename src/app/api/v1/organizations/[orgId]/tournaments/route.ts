import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLACEHOLDER_DATE = "2099-12-31";
const PLACEHOLDER_DEADLINE = "2099-12-30T23:59:59Z";

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

interface CreateTournamentBody {
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

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
    .eq("user_id", user.id)
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
          message: "Admin or owner role required to create tournaments",
        },
      },
      { status: 403 },
    );
  }

  let body: CreateTournamentBody;
  try {
    body = (await request.json()) as CreateTournamentBody;
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Tournament name is required",
        },
      },
      { status: 400 },
    );
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  const venue_name =
    typeof body.venue_name === "string" ? body.venue_name.trim() : "";
  const venue_state =
    typeof body.venue_state === "string" ? body.venue_state.trim() : "";
  const venue_address =
    typeof body.venue_address === "string" ? body.venue_address.trim() : "";

  const start_date =
    typeof body.start_date === "string" && body.start_date
      ? body.start_date
      : PLACEHOLDER_DATE;
  const end_date =
    typeof body.end_date === "string" && body.end_date
      ? body.end_date
      : PLACEHOLDER_DATE;
  const registration_deadline =
    typeof body.registration_deadline === "string" && body.registration_deadline
      ? body.registration_deadline
      : PLACEHOLDER_DEADLINE;

  const max_participants =
    typeof body.max_participants === "number" && body.max_participants >= 2
      ? body.max_participants
      : 2;

  const is_fide_rated =
    typeof body.is_fide_rated === "boolean" ? body.is_fide_rated : false;
  const is_mcf_rated =
    typeof body.is_mcf_rated === "boolean" ? body.is_mcf_rated : false;

  const format = {
    type: body.format?.type ?? "",
    system: body.format?.system ?? "",
    rounds: body.format?.rounds ?? 0,
  };

  const time_control = {
    base_minutes: body.time_control?.base_minutes ?? 0,
    increment_seconds: body.time_control?.increment_seconds ?? 0,
    delay_seconds: body.time_control?.delay_seconds ?? 0,
  };

  const entry_fees: EntryFeesInput = body.entry_fees ?? {
    standard: { amount_cents: 0 },
    additional: [],
  };
  if (!entry_fees.standard) {
    entry_fees.standard = { amount_cents: 0 };
  }
  if (!entry_fees.additional) {
    entry_fees.additional = [];
  }

  const prizes =
    body.prizes &&
    (Array.isArray(body.prizes.categories) ||
      Array.isArray(body.prizes.special))
      ? body.prizes
      : null;

  const restrictions = Array.isArray(body.restrictions)
    ? body.restrictions
    : null;

  const { data: tournament, error: insertError } = await supabaseAdmin
    .from("tournaments")
    .insert({
      organization_id: orgId,
      name,
      description,
      venue_name,
      venue_state,
      venue_address,
      start_date,
      end_date,
      registration_deadline,
      format,
      time_control,
      is_fide_rated,
      is_mcf_rated,
      entry_fees,
      prizes,
      restrictions,
      max_participants,
      status: "draft",
    })
    .select("id, name, status, created_at")
    .single();

  if (insertError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: insertError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: tournament }, { status: 201 });
}
