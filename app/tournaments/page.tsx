import { supabaseAdmin } from "@/lib/supabase/admin";
import NavBar from "@/app/_components/NavBar";
import TournamentsClient from "./_components/TournamentsClient";
import type { Tournament } from "./types";

export const revalidate = 60;

export default async function TournamentsPage() {
  const { data: rows, error } = await supabaseAdmin
    .from("tournaments")
    .select(
      `id, name, venue_name, venue_state, start_date, end_date, registration_deadline,
       format, time_control, is_fide_rated, is_mcf_rated, entry_fees, max_participants, poster_url, status,
       organizer_profiles(id, organization_name, links)`
    )
    .eq("status", "published")
    .order("start_date", { ascending: true });

  const tournaments: Tournament[] = [];

  if (!error && rows) {
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
          participantCounts[reg.tournament_id] =
            (participantCounts[reg.tournament_id] ?? 0) + 1;
        }
      }
    }

    interface OrganizerProfile {
      id: string;
      organization_name: string;
      links: unknown;
    }

    interface RawRow {
      id: string;
      name: string;
      venue_name: string;
      venue_state: string;
      start_date: string;
      end_date: string;
      registration_deadline: string;
      format: unknown;
      time_control: unknown;
      is_fide_rated: boolean;
      is_mcf_rated: boolean;
      entry_fees: unknown;
      max_participants: number;
      poster_url: string | null;
      status: string;
      organizer_profiles: OrganizerProfile | OrganizerProfile[] | null;
    }

    for (const raw of rows as RawRow[]) {
      const orgRaw = raw.organizer_profiles;
      const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw;

      tournaments.push({
        id: raw.id,
        name: raw.name,
        venue_name: raw.venue_name,
        state: raw.venue_state,
        start_date: raw.start_date,
        end_date: raw.end_date,
        registration_deadline: raw.registration_deadline,
        format: raw.format as Tournament["format"],
        time_control: raw.time_control as Tournament["time_control"],
        is_fide_rated: raw.is_fide_rated,
        is_mcf_rated: raw.is_mcf_rated,
        entry_fees: raw.entry_fees as Tournament["entry_fees"],
        max_participants: raw.max_participants,
        current_participants: participantCounts[raw.id] ?? 0,
        poster_url: raw.poster_url,
        status: raw.status,
        organizer: org
          ? {
              id: org.id,
              organization_name: org.organization_name,
              links: org.links,
            }
          : null,
      });
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg-base)" }}>
      <NavBar />
      <TournamentsClient tournaments={tournaments} />
    </div>
  );
}
