import {
  getTodayInTimeZone,
  getTournamentDateState,
  resolveTimeZone,
} from "@/lib/tournaments/datetime";
import type { PlayerRegistration } from "./types";

export type RegistrationTab = "ongoing" | "upcoming" | "past" | "cancelled";

type RegistrationTournament = PlayerRegistration["tournament"];

// Today at the venue, as "YYYY-MM-DD". Compared as a string against the
// tournament's calendar dates, the same way discovery does, so neither the
// reader's device clock nor its timezone can move a tournament between tabs.
function venueToday(tournament: RegistrationTournament, now: Date): string {
  return getTodayInTimeZone(resolveTimeZone(tournament.timezone), now);
}

/**
 * Which /my tab a registration belongs in.
 *
 * Ongoing runs from the first day through the last day at the venue, so a
 * player on day 2 of a 3-day event finds it there, not under Past (#619).
 * The split matches discovery's Ongoing / Upcoming / Past sections.
 */
export function classifyRegistration(
  reg: PlayerRegistration,
  now: Date = new Date(),
): RegistrationTab {
  // A cancelled tournament leaves the registration itself `confirmed` (the
  // refund ledger, not the registration, records the money going back), so
  // without this it would sit under Upcoming looking like a live entry.
  if (reg.tournament.status === "cancelled") return "cancelled";
  if (reg.status === "cancelled_payment" || reg.status === "failed_payment") {
    return "cancelled";
  }

  const { start_date, end_date } = reg.tournament;
  const state = getTournamentDateState(
    start_date,
    end_date,
    venueToday(reg.tournament, now),
  );
  if (state === "ongoing") return "ongoing";
  return state === "upcoming" ? "upcoming" : "past";
}
