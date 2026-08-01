"use client";

import { useState, useMemo } from "react";
import type { Tournament } from "../types";
import { getTournamentDateState } from "../utils";
import {
  addCalendarDays,
  endOfMonth,
  getTodayInTimeZone,
  resolveTimeZone,
  startOfMonth,
} from "@/lib/datetime";
import FilterBar from "./FilterBar";
import TournamentCard from "./TournamentCard";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  now: string; // ISO instant from the server — keeps SSR and hydration in sync
}

export default function TournamentsClient({ tournaments, now }: Props) {
  const [search, setSearch] = useState("");
  const [formats, setFormats] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [ratings, setRatings] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState("any");

  // A tournament's dates are calendar dates at its venue, so every date
  // question — is it on this week, is it over — is asked against the day it is
  // at that venue right now. Two tournaments can therefore answer differently
  // at the same instant. Resolved once per distinct zone rather than per
  // tournament: Intl formatting isn't free and most of the list shares a
  // handful of zones.
  const todayByZone = useMemo(() => {
    const instant = new Date(now);
    const zones = new Set(tournaments.map((t) => resolveTimeZone(t.timezone)));
    return new Map(
      [...zones].map((zone) => [zone, getTodayInTimeZone(zone, instant)]),
    );
  }, [now, tournaments]);

  const filtered = useMemo(() => {
    return tournaments.filter((t) => {
      const today = todayByZone.get(resolveTimeZone(t.timezone)) ?? "";
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

      // Date — "YYYY-MM-DD" strings compare chronologically as strings, so the
      // windows are built from the venue's today without ever constructing a
      // Date (which would re-introduce a runtime-timezone day shift).
      if (dateFilter === "this-week") {
        if (t.start_date > addCalendarDays(today, 7) || t.end_date < today)
          return false;
      } else if (dateFilter === "this-month") {
        if (
          t.start_date > endOfMonth(today) ||
          t.end_date < startOfMonth(today)
        )
          return false;
      } else if (dateFilter === "next-month") {
        if (
          t.start_date > endOfMonth(today, 1) ||
          t.end_date < startOfMonth(today, 1)
        )
          return false;
      }

      return true;
    });
  }, [tournaments, search, formats, states, ratings, dateFilter, todayByZone]);

  const { ongoing, upcoming, past } = useMemo(() => {
    // Past section shows tournaments that ended within the last 30 days; older
    // ones will be reachable via a future archive search.
    const PAST_WINDOW_DAYS = 30;

    const ongoing: Tournament[] = [];
    const upcoming: Tournament[] = [];
    const past: Tournament[] = [];

    for (const t of filtered) {
      // Defensive: malformed dates would otherwise be silently dropped.
      if (!DATE_RE.test(t.start_date) || !DATE_RE.test(t.end_date)) {
        console.warn(
          `Tournament ${t.id} has an invalid start/end date; excluded from listing`,
        );
        continue;
      }

      const today = todayByZone.get(resolveTimeZone(t.timezone)) ?? "";
      const state = getTournamentDateState(t.start_date, t.end_date, today);

      if (state === "ongoing") {
        ongoing.push(t);
      } else if (state === "upcoming") {
        upcoming.push(t);
      } else if (t.end_date >= addCalendarDays(today, -PAST_WINDOW_DAYS)) {
        past.push(t);
      }
      // else: ended more than 30 days ago — hidden (use archive search)
    }

    return { ongoing, upcoming, past };
  }, [filtered, todayByZone]);

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
