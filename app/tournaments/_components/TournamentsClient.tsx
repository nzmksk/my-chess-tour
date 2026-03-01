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
        if (
          !t.name.toLowerCase().includes(q) &&
          !t.venue_name.toLowerCase().includes(q)
        ) {
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
      if (dateFilter === "this-week") {
        const limit = new Date(now);
        limit.setDate(limit.getDate() + 7);
        if (start > limit) return false;
      } else if (dateFilter === "this-month") {
        if (
          start.getMonth() !== now.getMonth() ||
          start.getFullYear() !== now.getFullYear()
        ) {
          return false;
        }
      } else if (dateFilter === "next-month") {
        const nextStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const nextEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        if (start < nextStart || start > nextEnd) return false;
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
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "24px 40px",
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "80px 20px",
              color: "var(--color-text-muted)",
            }}
          >
            <div
              style={{
                fontSize: "40px",
                marginBottom: "16px",
                opacity: 0.3,
              }}
            >
              ♟
            </div>
            <p
              style={{
                fontFamily: "var(--font-lato)",
                fontSize: "15px",
                lineHeight: "1.6",
              }}
            >
              {tournaments.length === 0
                ? "No published tournaments at the moment. Check back soon."
                : "No tournaments match your filters."}
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
              gap: "16px",
            }}
          >
            {filtered.map((t) => (
              <TournamentCard key={t.id} tournament={t} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
