"use client";

import { useState, useMemo } from "react";
import type { Tournament } from "../types";
import FilterBar from "./FilterBar";
import TournamentCard from "./TournamentCard";

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
      if (states.length > 0 && !states.includes(t.state)) {
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

      // Date
      const start = new Date(t.start_date);
      const end = new Date(t.end_date);
      if (dateFilter === "this-week") {
        const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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

      {/* Tournament grid */}
      <div className="max-w-300 mx-auto px-10 py-6">
        {filtered.length === 0 ? (
          <div className="text-center py-20 px-5 text-(--color-text-muted)">
            <div className="text-[2.5rem] mb-4 opacity-30">♟</div>
            <p className="text-[0.9375rem] leading-[1.6]">
              {tournaments.length === 0
                ? "No published tournaments at the moment. Check back soon."
                : "No tournaments match your filters."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
            {filtered.map((t) => (
              <TournamentCard key={t.id} tournament={t} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
