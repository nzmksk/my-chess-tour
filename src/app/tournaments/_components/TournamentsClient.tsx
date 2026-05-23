"use client";

import { useState, useMemo } from "react";
import type { Tournament } from "../types";
import FilterBar from "./FilterBar";
import TournamentCard from "./TournamentCard";

function SectionBanner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4 mb-4">
      <span className="font-cinzel text-text-muted text-xs tracking-widest uppercase shrink-0">
        {label}
      </span>
      <div className="h-px bg-border flex-1" />
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
}

export default function TournamentsClient({ tournaments }: Props) {
  const [search, setSearch] = useState("");
  const [formats, setFormats] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [ratings, setRatings] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState("any");

  const filtered = useMemo(() => {
    const now = new Date();

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
  }, [tournaments, search, formats, states, ratings, dateFilter]);

  const { ongoing, upcoming, past } = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const ongoing: Tournament[] = [];
    const upcoming: Tournament[] = [];
    const past: Tournament[] = [];

    for (const t of filtered) {
      const start = new Date(t.start_date + "T00:00:00");
      const end = new Date(t.end_date + "T00:00:00");

      if (start <= todayStart && end >= todayStart) {
        ongoing.push(t);
      } else if (start > todayStart) {
        upcoming.push(t);
      } else if (end >= lastMonthStart) {
        past.push(t);
      }
      // else: ended before last calendar month — hidden
    }

    return { ongoing, upcoming, past };
  }, [filtered]);

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
      <div className="max-w-300 mx-auto px-10 py-6">
        {totalVisible === 0 ? (
          <div className="text-center py-20 px-5 text-text-muted">
            <div className="text-4xl mb-4 opacity-30">♟</div>
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
