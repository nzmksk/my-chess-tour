import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

interface Organization {
  id: string;
  name: string;
  description?: string;
  avatar_url?: string;
  links: unknown;
  email: string;
  phone?: string;
}

interface TournamentRow {
  id: string;
  name: string;
  description?: string;
  venue_name: string;
  venue_state: string;
  venue_address: string;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  format: unknown;
  time_control: unknown;
  is_fide_rated: boolean;
  is_mcf_rated: boolean;
  entry_fees: unknown;
  prizes: unknown;
  restrictions: unknown;
  max_participants: number;
  status: string;
  published_at: string;
  updated_at: string;
  organizations: Organization[] | Organization;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [{ data: row, error }, { count: currentParticipants }] =
    await Promise.all([
      supabaseAdmin
        .from("tournaments")
        .select(
          `id, name, description, venue_name, venue_state, venue_address,
           start_date, end_date, registration_deadline, format,
           time_control, is_fide_rated, is_mcf_rated, entry_fees, prizes,
           restrictions, max_participants, status, published_at, updated_at,
           organizations(id, name, description, avatar_url, links, email, phone)`,
        )
        .eq("id", id)
        .eq("status", "published")
        .single(),

      supabaseAdmin
        .from("registrations")
        .select("*", { count: "exact", head: true })
        .eq("tournament_id", id)
        .eq("status", "confirmed"),
    ]);

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Tournament not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const t = row as TournamentRow;
  const orgRaw = t.organizations;
  const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw;

  const data = {
    id: t.id,
    name: t.name,
    description: t.description,
    venue: {
      name: t.venue_name,
      state: t.venue_state,
      address: t.venue_address,
    },
    start_date: t.start_date,
    end_date: t.end_date,
    registration_deadline: t.registration_deadline,
    format: t.format,
    time_control: t.time_control,
    is_fide_rated: t.is_fide_rated,
    is_mcf_rated: t.is_mcf_rated,
    entry_fees: t.entry_fees,
    prizes: t.prizes,
    restrictions: t.restrictions,
    max_participants: t.max_participants,
    current_participants: currentParticipants ?? 0,
    status: t.status,
    published_at: t.published_at,
    updated_at: t.updated_at,
    organization: org,
  };

  return NextResponse.json({ data });
}
