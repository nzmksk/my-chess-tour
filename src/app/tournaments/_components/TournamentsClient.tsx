"use client";

import { useState, useMemo } from "react";
import type { Tournament } from "../types";
import FilterBar from "./FilterBar";
import TournamentCard from "./TournamentCard";

function SectionBanner({ label }: { label: string }) {
  return (
    <div className="mb-4 flex items-center gap-4">
      <span className="font-cinzel text-text-muted shrink-0 text-xs tracking-widest uppercase">
        {label}
      </span>
      <div className="bg-border h-px flex-1" />
    </div>
  );
}

const MALAYSIAN_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
  "W.P. Kuala Lumpur",
  "W.P. Labuan",
  "W.P. Putrajaya",
];

interface Props {
  tournaments: Tournament[];
  today: string; // "YYYY-MM-DD" from server — keeps SSR and hydration in sync
}

export default function TournamentsClient({ tournaments, today }: Props) {
  const [search, setSearch] = useState("");
  const [formats, setFormats] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [ratings, setRatings] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState("any");

  const filtered = useMemo(() => {
    const now = new Date(today + "T00:00:00");

    return tournaments.filter((t) => {
      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!t.name.toLowerCase().includes(q)) {
          return false;
        }
      }

      // Format
      if (
        formats.length > 0 &&
        !formats.includes(t.format?.type?.toLowerCase() ?? "")
      ) {
        return false;
      }

      // State
      if (states.length > 0 && !states.includes(t.venue.state)) {
        return false;
      }

      // Rating
      if (ratings.length > 0) {
        const matchFide = ratings.includes("fide") && t.is_fide_rated;
        const matchMcf = ratings.includes("mcf") && t.is_mcf_rated;
        const matchUnrated =
          ratings.includes("unrated") && !t.is_fide_rated && !t.is_mcf_rated;
        if (!matchFide && !matchMcf && !matchUnrated) return false;
      }

      // Date — append T00:00:00 (no Z) so strings parse as local midnight,
      // matching how windowStart/windowEnd are constructed via `new Date(y,m,d)`.
      // Without this, date-only strings parse as UTC midnight, which in UTC+
      // timezones (e.g. Malaysia UTC+08) falls after local midnight and causes
      // boundary-day tournaments to be incorrectly excluded.
      const start = new Date(t.start_date + "T00:00:00");
      const end = new Date(t.end_date + "T00:00:00");
      if (dateFilter === "this-week") {
        const windowStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        const windowEnd = new Date(windowStart);
        windowEnd.setDate(windowEnd.getDate() + 7);
        if (start > windowEnd || end < windowStart) return false;
      } else if (dateFilter === "this-month") {
        const windowStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const windowEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        if (start > windowEnd || end < windowStart) return false;
      } else if (dateFilter === "next-month") {
        const windowStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const windowEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        if (start > windowEnd || end < windowStart) return false;
      }

      return true;
    });
  }, [tournaments, search, formats, states, ratings, dateFilter, today]);

  const { ongoing, upcoming, past } = useMemo(() => {
    const todayStart = new Date(today + "T00:00:00");
    // Past section shows tournaments that ended within the last 30 days; older
    // ones will be reachable via a future archive search.
    const PAST_WINDOW_DAYS = 30;
    const cutoff = new Date(todayStart);
    cutoff.setDate(cutoff.getDate() - PAST_WINDOW_DAYS);

    const ongoing: Tournament[] = [];
    const upcoming: Tournament[] = [];
    const past: Tournament[] = [];

    for (const t of filtered) {
      const start = new Date(t.start_date + "T00:00:00");
      const end = new Date(t.end_date + "T00:00:00");

      // Defensive: malformed dates would otherwise be silently dropped.
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        console.warn(
          `Tournament ${t.id} has an invalid start/end date; excluded from listing`,
        );
        continue;
      }

      if (start <= todayStart && end >= todayStart) {
        ongoing.push(t);
      } else if (start > todayStart) {
        upcoming.push(t);
      } else if (end >= cutoff) {
        past.push(t);
      }
      // else: ended more than 30 days ago — hidden (use archive search)
    }

    return { ongoing, upcoming, past };
  }, [filtered, today]);

  const totalVisible = ongoing.length + upcoming.length + past.length;

  return (
    <>
      {/* Filter bar */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        formats={formats}
        onFormatsChange={setFormats}
        states={states}
        onStatesChange={setStates}
        ratings={ratings}
        onRatingsChange={setRatings}
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        allStates={MALAYSIAN_STATES}
      />

      {/* Tournament sections */}
      <div className="mx-auto max-w-300 px-10 py-6">
        {totalVisible === 0 ? (
          <div className="text-text-muted px-5 py-20 text-center">
            <div className="mb-4 text-4xl opacity-30">♟</div>
            <p className="text-sm leading-relaxed">
              {tournaments.length === 0
                ? "No tournaments are currently published. Check back soon."
                : "No tournaments match your current filters."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {ongoing.length > 0 && (
              <section>
                <SectionBanner label="Ongoing" />
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
                  {ongoing.map((t) => (
                    <TournamentCard key={t.id} tournament={t} />
                  ))}
                </div>
              </section>
            )}
            {upcoming.length > 0 && (
              <section>
                <SectionBanner label="Upcoming" />
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
                  {upcoming.map((t) => (
                    <TournamentCard key={t.id} tournament={t} />
                  ))}
                </div>
              </section>
            )}
            {past.length > 0 && (
              <section>
                <SectionBanner label="Past Tournaments" />
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
                  {past.map((t) => (
                    <TournamentCard key={t.id} tournament={t} dimmed />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}
