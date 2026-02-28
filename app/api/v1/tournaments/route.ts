import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

const VALID_SORTS = ["start_date", "created_at", "name"] as const;
const VALID_ORDERS = ["asc", "desc"] as const;
const VALID_DATES = ["upcoming", "this_week", "this_month", "past"] as const;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type ValidSort = (typeof VALID_SORTS)[number];

interface CursorData {
  value: string;
  id: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const search = searchParams.get("search") ?? undefined;
  const format = searchParams.get("format") ?? undefined;
  const state = searchParams.get("state") ?? undefined;
  const rating = searchParams.get("rating") ?? undefined;
  const date = searchParams.get("date") ?? undefined;
  const sort = searchParams.get("sort") ?? "start_date";
  const order = searchParams.get("order") ?? "asc";
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitParam = searchParams.get("limit");

  // --- Validate params -------------------------------------------------------

  if (!VALID_SORTS.includes(sort as ValidSort)) {
    return NextResponse.json(
      { error: `Invalid sort value. Must be one of: ${VALID_SORTS.join(", ")}` },
      { status: 400 }
    );
  }

  if (!VALID_ORDERS.includes(order as "asc" | "desc")) {
    return NextResponse.json(
      { error: `Invalid order value. Must be one of: ${VALID_ORDERS.join(", ")}` },
      { status: 400 }
    );
  }

  if (date && !VALID_DATES.includes(date as (typeof VALID_DATES)[number])) {
    return NextResponse.json(
      { error: `Invalid date value. Must be one of: ${VALID_DATES.join(", ")}` },
      { status: 400 }
    );
  }

  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1) {
      return NextResponse.json(
        { error: "Invalid limit value. Must be a positive integer." },
        { status: 400 }
      );
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  let cursorData: CursorData | null = null;
  if (cursor) {
    try {
      cursorData = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8")) as CursorData;
    } catch {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
  }

  // --- Build query -----------------------------------------------------------

  const supabase = supabaseAdmin;
  const ascending = order === "asc";

  // Fetch limit+1 to determine whether there is a next page.
  let query = supabase
    .from("tournaments")
    .select(
      `id, name, venue_name, venue_state, start_date, end_date, registration_deadline,
       format, is_fide_rated, is_mcf_rated, entry_fees, max_participants, poster_url, status,
       organizer_profiles(id, organization_name, links)`
    )
    .eq("status", "published");

  if (search) {
    query = query.or(`name.ilike.%${search}%,venue_name.ilike.%${search}%`);
  }

  if (format) {
    const formats = format
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    if (formats.length === 1) {
      query = query.filter("format->>type", "eq", formats[0]);
    } else {
      const orFilter = formats.map((f) => `format->>type.eq.${f}`).join(",");
      query = query.or(orFilter);
    }
  }

  if (state) {
    const states = state
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    query = query.in("venue_state", states);
  }

  if (rating) {
    const ratings = rating
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);
    const hasFide = ratings.includes("fide");
    const hasMcf = ratings.includes("mcf");
    if (hasFide && hasMcf) {
      query = query.or("is_fide_rated.eq.true,is_mcf_rated.eq.true");
    } else if (hasFide) {
      query = query.eq("is_fide_rated", true);
    } else if (hasMcf) {
      query = query.eq("is_mcf_rated", true);
    }
  }

  const today = new Date().toISOString().split("T")[0];
  if (date === "upcoming") {
    query = query.gte("start_date", today);
  } else if (date === "this_week") {
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    query = query.gte("start_date", today).lte("start_date", weekEnd.toISOString().split("T")[0]);
  } else if (date === "this_month") {
    const monthEnd = new Date();
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    query = query
      .gte("start_date", today)
      .lte("start_date", monthEnd.toISOString().split("T")[0]);
  } else if (date === "past") {
    query = query.lt("end_date", today);
  }

  if (cursorData) {
    if (ascending) {
      query = query.or(
        `${sort}.gt.${cursorData.value},and(${sort}.eq.${cursorData.value},id.gt.${cursorData.id})`
      );
    } else {
      query = query.or(
        `${sort}.lt.${cursorData.value},and(${sort}.eq.${cursorData.value},id.lt.${cursorData.id})`
      );
    }
  }

  query = query
    .order(sort, { ascending })
    .order("id", { ascending })
    .limit(limit + 1);

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ error: (error as { message: string }).message }, { status: 500 });
  }

  // --- Participant counts (DB fallback) -------------------------------------

  const has_more = (rows as unknown[]).length > limit;
  const tournaments = has_more
    ? (rows as unknown[]).slice(0, limit)
    : (rows as unknown[]);

  const ids = (tournaments as Array<{ id: string }>).map((t) => t.id);
  const participantCounts: Record<string, number> = {};

  if (ids.length > 0) {
    const { data: regData } = await supabase
      .from("registrations")
      .select("tournament_id")
      .in("tournament_id", ids)
      .eq("status", "confirmed");

    if (regData) {
      for (const reg of regData as Array<{ tournament_id: string }>) {
        participantCounts[reg.tournament_id] = (participantCounts[reg.tournament_id] ?? 0) + 1;
      }
    }
  }

  // --- Shape response -------------------------------------------------------

  interface OrganizerProfile {
    id: string;
    organization_name: string;
    links: unknown;
  }

  interface TournamentRow {
    id: string;
    name: string;
    venue_name: string;
    venue_state: string;
    start_date: string;
    end_date: string;
    registration_deadline: string;
    format: unknown;
    is_fide_rated: boolean;
    is_mcf_rated: boolean;
    entry_fees: unknown;
    max_participants: number;
    poster_url: string | null;
    status: string;
    organizer_profiles: OrganizerProfile | OrganizerProfile[] | null;
    [key: string]: unknown;
  }

  const data = (tournaments as TournamentRow[]).map((t) => {
    const orgRaw = t.organizer_profiles;
    const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw;

    return {
      id: t.id,
      name: t.name,
      venue_name: t.venue_name,
      state: t.venue_state,
      start_date: t.start_date,
      end_date: t.end_date,
      registration_deadline: t.registration_deadline,
      format: t.format,
      is_fide_rated: t.is_fide_rated,
      is_mcf_rated: t.is_mcf_rated,
      entry_fees: t.entry_fees,
      max_participants: t.max_participants,
      current_participants: participantCounts[t.id] ?? 0,
      poster_url: t.poster_url,
      status: t.status,
      organizer: org
        ? { id: org.id, organization_name: org.organization_name, links: org.links }
        : null,
    };
  });

  let next_cursor: string | null = null;
  if (has_more && tournaments.length > 0) {
    const last = (tournaments as TournamentRow[])[tournaments.length - 1];
    const payload: CursorData = { value: String(last[sort]), id: last.id };
    next_cursor = Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  return NextResponse.json({ data, next_cursor, has_more });
}
