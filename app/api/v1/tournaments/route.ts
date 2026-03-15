import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

interface TournamentRow {
  id: string;
  organization_id: string;
  name: string;
  venue_name: string;
  venue_state: string;
  start_date: string;
  end_date: string;
  format: unknown;
  time_control: unknown;
  is_fide_rated: boolean;
  is_mcf_rated: boolean;
  entry_fees: unknown;
  restrictions: unknown;
  max_participants: number;
  status: string;
}

interface ParticipantCount {
  tournament_id: string;
  count: number;
}

export async function GET() {
  const { data: rows, error } = await supabaseAdmin
    .from("tournaments")
    .select(
      `id, organization_id, name, venue_name, venue_state, start_date,
      end_date, format, time_control, is_fide_rated, is_mcf_rated, entry_fees,
      restrictions, max_participants, status`,
    )
    .eq("status", "published")
    .order("start_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const participantCounts: Record<string, number> = {};
  const ids = (rows as TournamentRow[]).map((t) => t.id);

  if (ids.length > 0) {
    const { data: countsData } = await supabaseAdmin.rpc(
      "get_participant_counts",
      { tournament_ids: ids },
    );
    if (countsData) {
      for (const row of countsData as ParticipantCount[]) {
        participantCounts[row.tournament_id] = row.count;
      }
    }
  }

  const data = (rows as TournamentRow[]).map((t) => {
    return {
      id: t.id,
      organization_id: t.organization_id,
      name: t.name,
      venue: {
        name: t.venue_name,
        state: t.venue_state,
      },
      start_date: t.start_date,
      end_date: t.end_date,
      format: t.format,
      time_control: t.time_control,
      is_fide_rated: t.is_fide_rated,
      is_mcf_rated: t.is_mcf_rated,
      entry_fees: t.entry_fees,
      restrictions: t.restrictions,
      max_participants: t.max_participants,
      current_participants: participantCounts[t.id] ?? 0,
      status: t.status,
    };
  });

  return NextResponse.json({ data });
}
