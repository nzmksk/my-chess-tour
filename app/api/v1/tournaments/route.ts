import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export async function GET() {
  const { data: rows, error } = await supabaseAdmin
    .from("tournaments")
    .select(
      `id, name, venue_name, venue_state, start_date, end_date, registration_deadline,
       format, is_fide_rated, is_mcf_rated, entry_fees, max_participants, poster_url, status,
       organizer_profiles(id, organization_name, links)`
    )
    .eq("status", "published")
    .order("start_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (rows as Array<{ id: string }>).map((t) => t.id);
  const participantCounts: Record<string, number> = {};

  if (ids.length > 0) {
    const { data: regData } = await supabaseAdmin
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
  }

  const data = (rows as TournamentRow[]).map((t) => {
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

  return NextResponse.json({ data });
}
