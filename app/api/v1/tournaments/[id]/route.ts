import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

interface OrganizerProfile {
  id: string;
  organization_name: string;
  description: string | null;
  links: unknown;
  email: string;
  phone: string | null;
}

interface TournamentRow {
  id: string;
  name: string;
  description: string | null;
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
  created_at: string;
  updated_at: string;
  organizer_profiles: OrganizerProfile | OrganizerProfile[] | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: row, error } = await supabaseAdmin
    .from("tournaments")
    .select(
      `id, name, description, venue_name, venue_state, venue_address,
       start_date, end_date, registration_deadline,
       format, time_control, is_fide_rated, is_mcf_rated,
       entry_fees, prizes, restrictions, max_participants, status,
       created_at, updated_at,
       organizer_profiles(id, organization_name, description, links, email, phone)`,
    )
    .eq("id", id)
    .eq("status", "published")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Tournament not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: regData } = await supabaseAdmin
    .from("registrations")
    .select("tournament_id")
    .eq("tournament_id", id)
    .eq("status", "registered");

  const currentParticipants = regData ? regData.length : 0;

  const t = row as TournamentRow;
  const orgRaw = t.organizer_profiles;
  const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw;

  const data = {
    id: t.id,
    name: t.name,
    description: t.description,
    venue_name: t.venue_name,
    state: t.venue_state,
    venue_address: t.venue_address,
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
    current_participants: currentParticipants,
    status: t.status,
    created_at: t.created_at,
    updated_at: t.updated_at,
    organizer: org
      ? {
          id: org.id,
          organization_name: org.organization_name,
          description: org.description,
          links: org.links,
          email: org.email,
          phone: org.phone,
        }
      : null,
  };

  return NextResponse.json({ data });
}
