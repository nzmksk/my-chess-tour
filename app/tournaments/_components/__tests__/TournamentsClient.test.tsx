/* eslint-disable @next/next/no-img-element */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TournamentsClient from "../TournamentsClient";
import type { Tournament } from "../../types";

// ── React useState interception for component-level date filter tests ──
//
// vi.hoisted creates module-level state accessible inside vi.mock factories.
// When `__dateFilterOverride` is non-null, the 5th useState call in each
// TournamentsClient render receives that value instead of "any".
// `__useStateCallCount` is reset to 0 before each controlled render so the
// counter stays in sync with the component's call order.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  // Shadow the closure variables so the mock factory can use them:
  let _callCount = 0;
  let _override: string | null = null;
  // Expose setters so tests can drive the behavior:
  (globalThis as Record<string, unknown>).__setReactUseStateOverride = (v: string | null) => {
    _override = v;
    _callCount = 0;
  };
  (globalThis as Record<string, unknown>).__resetReactUseStateCounter = () => { _callCount = 0; };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrappedUseState = (initial: any) => {
    _callCount += 1;
    if (_callCount === 5 && _override !== null) {
      const injected = _override;
      _callCount = 0; // reset after the component's 5 useState calls are done
      return actual.useState(injected);
    }
    return actual.useState(initial);
  };

  return { ...actual, useState: wrappedUseState };
});

import * as React from "react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
  }: {
    src: string;
    alt: string;
    className?: string;
  }) => <img src={src} alt={alt} className={className} />,
}));

// ── Helpers ───────────────────────────────────────────────────

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: "1",
    name: "Default Tournament",
    venue_name: "Test Venue",
    state: "Selangor",
    start_date: "2026-03-10",
    end_date: "2026-03-10",
    registration_deadline: "2026-03-09",
    format: { type: "rapid", system: "swiss", rounds: 7 },
    time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 0 },
    is_fide_rated: false,
    is_mcf_rated: false,
    entry_fees: { standard: { amount_cents: 5000 } },
    max_participants: 100,
    current_participants: 50,
    poster_url: null,
    status: "published",
    organizer: null,
    ...overrides,
  };
}

/**
 * Mirrors the filter logic in TournamentsClient so the filtering behaviour
 * can be tested as a pure function without needing jsdom to drive state.
 * Keep in sync with the useMemo block in TournamentsClient.tsx.
 */
function filterTournaments(
  tournaments: Tournament[],
  {
    search = "",
    formats = [] as string[],
    states = [] as string[],
    ratings = [] as string[],
    dateFilter = "any",
    now = new Date(),
  } = {},
) {
  return tournaments.filter((t) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!t.name.toLowerCase().includes(q)) return false;
    }

    if (
      formats.length > 0 &&
      !formats.includes(t.format?.type?.toLowerCase() ?? "")
    ) {
      return false;
    }

    if (states.length > 0 && !states.includes(t.state)) return false;

    if (ratings.length > 0) {
      const matchFide = ratings.includes("fide") && t.is_fide_rated;
      const matchMcf = ratings.includes("mcf") && t.is_mcf_rated;
      const matchUnrated =
        ratings.includes("unrated") && !t.is_fide_rated && !t.is_mcf_rated;
      if (!matchFide && !matchMcf && !matchUnrated) return false;
    }

    const start = new Date(t.start_date);
    const end = new Date(t.end_date);
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
}

// Fixed "now" used across all date-filter tests: 2026-03-10
const NOW = new Date(2026, 2, 10); // month is 0-indexed

// ── Initial render (smoke test) ───────────────────────────────

describe("initial render", () => {
  it("renders all tournaments when no filters are applied", () => {
    const tournaments = [
      makeTournament({ id: "1", name: "Alpha" }),
      makeTournament({ id: "2", name: "Beta" }),
    ];
    const html = renderToStaticMarkup(
      <TournamentsClient tournaments={tournaments} />,
    );
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
  });

  it("renders empty-state message when no tournaments are provided", () => {
    const html = renderToStaticMarkup(<TournamentsClient tournaments={[]} />);
    expect(html).toContain("No published tournaments");
  });
});

// ── Search filter ─────────────────────────────────────────────

describe("search filter", () => {
  const tournaments = [
    makeTournament({ id: "1", name: "Selangor Open 2026" }),
    makeTournament({ id: "2", name: "KL Rapid Chess Championship" }),
  ];

  it("includes tournaments whose name matches the query (case-insensitive)", () => {
    const result = filterTournaments(tournaments, { search: "selangor" });
    expect(result.map((t) => t.name)).toEqual(["Selangor Open 2026"]);
  });

  it("excludes tournaments that do not match the query", () => {
    const result = filterTournaments(tournaments, { search: "selangor" });
    expect(result.map((t) => t.name)).not.toContain("KL Rapid Chess Championship");
  });

  it("returns all tournaments when search is empty", () => {
    const result = filterTournaments(tournaments, { search: "" });
    expect(result).toHaveLength(2);
  });

  it("ignores whitespace-only search", () => {
    const result = filterTournaments(tournaments, { search: "   " });
    expect(result).toHaveLength(2);
  });
});

// ── Format filter ─────────────────────────────────────────────

describe("format filter", () => {
  const tournaments = [
    makeTournament({ id: "1", name: "Blitz", format: { type: "blitz", system: "swiss", rounds: 9 } }),
    makeTournament({ id: "2", name: "Rapid", format: { type: "rapid", system: "swiss", rounds: 7 } }),
    makeTournament({ id: "3", name: "Classical", format: { type: "classical", system: "swiss", rounds: 5 } }),
  ];

  it("includes only tournaments matching the selected format", () => {
    const result = filterTournaments(tournaments, { formats: ["blitz"] });
    expect(result.map((t) => t.name)).toEqual(["Blitz"]);
  });

  it("supports multiple selected formats", () => {
    const result = filterTournaments(tournaments, { formats: ["blitz", "rapid"] });
    expect(result.map((t) => t.name)).toEqual(["Blitz", "Rapid"]);
  });

  it("is case-insensitive when matching format types", () => {
    const t = makeTournament({ format: { type: "Rapid", system: "swiss", rounds: 7 } });
    const result = filterTournaments([t], { formats: ["rapid"] });
    expect(result).toHaveLength(1);
  });

  it("returns all tournaments when no formats are selected", () => {
    const result = filterTournaments(tournaments, { formats: [] });
    expect(result).toHaveLength(3);
  });
});

// ── State filter ──────────────────────────────────────────────

describe("state filter", () => {
  const tournaments = [
    makeTournament({ id: "1", name: "Johor Open", state: "Johor" }),
    makeTournament({ id: "2", name: "Selangor Open", state: "Selangor" }),
    makeTournament({ id: "3", name: "Perak Open", state: "Perak" }),
  ];

  it("includes only tournaments in the selected state", () => {
    const result = filterTournaments(tournaments, { states: ["Selangor"] });
    expect(result.map((t) => t.name)).toEqual(["Selangor Open"]);
  });

  it("supports multiple selected states", () => {
    const result = filterTournaments(tournaments, { states: ["Johor", "Perak"] });
    expect(result.map((t) => t.name)).toEqual(["Johor Open", "Perak Open"]);
  });

  it("returns all tournaments when no states are selected", () => {
    const result = filterTournaments(tournaments, { states: [] });
    expect(result).toHaveLength(3);
  });
});

// ── Rating filter ─────────────────────────────────────────────

describe("rating filter", () => {
  const fide = makeTournament({ id: "1", name: "FIDE", is_fide_rated: true, is_mcf_rated: false });
  const mcf = makeTournament({ id: "2", name: "MCF", is_fide_rated: false, is_mcf_rated: true });
  const both = makeTournament({ id: "3", name: "Both", is_fide_rated: true, is_mcf_rated: true });
  const unrated = makeTournament({ id: "4", name: "Unrated", is_fide_rated: false, is_mcf_rated: false });
  const all = [fide, mcf, both, unrated];

  it("returns only FIDE-rated when 'fide' is selected", () => {
    const result = filterTournaments(all, { ratings: ["fide"] });
    expect(result.map((t) => t.name)).toEqual(["FIDE", "Both"]);
  });

  it("returns only MCF-rated when 'mcf' is selected", () => {
    const result = filterTournaments(all, { ratings: ["mcf"] });
    expect(result.map((t) => t.name)).toEqual(["MCF", "Both"]);
  });

  it("returns only unrated tournaments when 'unrated' is selected", () => {
    const result = filterTournaments(all, { ratings: ["unrated"] });
    expect(result.map((t) => t.name)).toEqual(["Unrated"]);
  });

  it("supports combining rating options", () => {
    const result = filterTournaments(all, { ratings: ["fide", "unrated"] });
    expect(result.map((t) => t.name)).toEqual(["FIDE", "Both", "Unrated"]);
  });

  it("returns all tournaments when no ratings are selected", () => {
    const result = filterTournaments(all, { ratings: [] });
    expect(result).toHaveLength(4);
  });
});

// ── Date filter ───────────────────────────────────────────────

describe("date filter — this-week (now = 2026-03-10)", () => {
  it("includes a tournament starting today", () => {
    const t = makeTournament({ start_date: "2026-03-10", end_date: "2026-03-10" });
    expect(filterTournaments([t], { dateFilter: "this-week", now: NOW })).toHaveLength(1);
  });

  it("includes a tournament fully within the next 7 days", () => {
    const t = makeTournament({ start_date: "2026-03-12", end_date: "2026-03-14" });
    expect(filterTournaments([t], { dateFilter: "this-week", now: NOW })).toHaveLength(1);
  });

  it("includes a tournament that started before today but ends within next 7 days", () => {
    const t = makeTournament({ start_date: "2026-03-08", end_date: "2026-03-11" });
    expect(filterTournaments([t], { dateFilter: "this-week", now: NOW })).toHaveLength(1);
  });

  it("includes a tournament that starts within the window but ends after it", () => {
    // window: 2026-03-10 to 2026-03-17; tournament starts inside, ends outside → overlaps
    const t = makeTournament({ start_date: "2026-03-15", end_date: "2026-03-20" });
    expect(filterTournaments([t], { dateFilter: "this-week", now: NOW })).toHaveLength(1);
  });

  it("excludes a tournament that ended before today", () => {
    const t = makeTournament({ start_date: "2026-03-01", end_date: "2026-03-09" });
    expect(filterTournaments([t], { dateFilter: "this-week", now: NOW })).toHaveLength(0);
  });

  it("excludes a tournament starting after the 7-day window", () => {
    const t = makeTournament({ start_date: "2026-03-18", end_date: "2026-03-20" });
    expect(filterTournaments([t], { dateFilter: "this-week", now: NOW })).toHaveLength(0);
  });
});

describe("date filter — this-month (now = 2026-03-10, month = March)", () => {
  it("includes a tournament fully within this month", () => {
    const t = makeTournament({ start_date: "2026-03-15", end_date: "2026-03-20" });
    expect(filterTournaments([t], { dateFilter: "this-month", now: NOW })).toHaveLength(1);
  });

  it("includes a tournament spanning from last month into this month", () => {
    const t = makeTournament({ start_date: "2026-02-25", end_date: "2026-03-05" });
    expect(filterTournaments([t], { dateFilter: "this-month", now: NOW })).toHaveLength(1);
  });

  it("includes a tournament spanning from this month into next month", () => {
    const t = makeTournament({ start_date: "2026-03-28", end_date: "2026-04-05" });
    expect(filterTournaments([t], { dateFilter: "this-month", now: NOW })).toHaveLength(1);
  });

  it("excludes a tournament fully in the previous month", () => {
    const t = makeTournament({ start_date: "2026-02-01", end_date: "2026-02-28" });
    expect(filterTournaments([t], { dateFilter: "this-month", now: NOW })).toHaveLength(0);
  });

  it("excludes a tournament fully in the next month", () => {
    const t = makeTournament({ start_date: "2026-04-01", end_date: "2026-04-10" });
    expect(filterTournaments([t], { dateFilter: "this-month", now: NOW })).toHaveLength(0);
  });
});

describe("date filter — next-month (now = 2026-03-10, next month = April)", () => {
  it("includes a tournament fully within next month", () => {
    const t = makeTournament({ start_date: "2026-04-10", end_date: "2026-04-15" });
    expect(filterTournaments([t], { dateFilter: "next-month", now: NOW })).toHaveLength(1);
  });

  it("includes a tournament spanning from this month into next month", () => {
    const t = makeTournament({ start_date: "2026-03-28", end_date: "2026-04-05" });
    expect(filterTournaments([t], { dateFilter: "next-month", now: NOW })).toHaveLength(1);
  });

  it("includes a tournament spanning from next month into the month after", () => {
    const t = makeTournament({ start_date: "2026-04-28", end_date: "2026-05-03" });
    expect(filterTournaments([t], { dateFilter: "next-month", now: NOW })).toHaveLength(1);
  });

  it("excludes a tournament fully in the current month", () => {
    const t = makeTournament({ start_date: "2026-03-01", end_date: "2026-03-31" });
    expect(filterTournaments([t], { dateFilter: "next-month", now: NOW })).toHaveLength(0);
  });

  it("excludes a tournament fully two months ahead", () => {
    const t = makeTournament({ start_date: "2026-05-01", end_date: "2026-05-10" });
    expect(filterTournaments([t], { dateFilter: "next-month", now: NOW })).toHaveLength(0);
  });
});

describe("date filter — any", () => {
  it("returns all tournaments regardless of date", () => {
    const tournaments = [
      makeTournament({ start_date: "2025-01-01", end_date: "2025-01-05" }),
      makeTournament({ start_date: "2026-03-10", end_date: "2026-03-10" }),
      makeTournament({ start_date: "2027-12-01", end_date: "2027-12-31" }),
    ];
    const result = filterTournaments(tournaments, { dateFilter: "any", now: NOW });
    expect(result).toHaveLength(3);
  });
});

// ── date filter branches — component level ────────────────────
//
// These tests exercise the filter branches inside TournamentsClient's useMemo
// at the component level (not just the pure helper above) by spying on
// React.useState to inject a specific dateFilter initial value and by using
// fake timers to fix `new Date()` inside the useMemo.

describe("date filter branches — component level", () => {
  // Fixed "now": 2026-03-10 (month is 0-indexed → 2 = March)
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 10));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Renders TournamentsClient with a pre-injected dateFilter state value.
   *
   * Uses the globalThis setter installed by the React mock factory above to
   * intercept the 5th useState call (dateFilter) in TournamentsClient and
   * replace its initial value with the given dateFilter string.
   *
   * useState call order in TournamentsClient:
   *   1. search     → ""
   *   2. formats    → []
   *   3. states     → []
   *   4. ratings    → []
   *   5. dateFilter → injected value  ← intercepted
   */
  function renderWithDateFilter(
    dateFilter: string,
    tournaments: Tournament[],
  ): string {
    // Arm the intercept
    (globalThis as Record<string, unknown>).__setReactUseStateOverride(dateFilter);
    try {
      return renderToStaticMarkup(
        <TournamentsClient tournaments={tournaments} />,
      );
    } finally {
      // Disarm for subsequent tests
      (globalThis as Record<string, unknown>).__setReactUseStateOverride(null);
    }
  }

  it("this-week filter hides tournaments outside the 7-day window", () => {
    // now = 2026-03-10; window = Mar 10 – Mar 17
    const inside = makeTournament({
      id: "w1",
      name: "Inside Week",
      start_date: "2026-03-12",
      end_date: "2026-03-14",
    });
    const outside = makeTournament({
      id: "w2",
      name: "Outside Week",
      start_date: "2026-03-20",
      end_date: "2026-03-22",
    });
    const html = renderWithDateFilter("this-week", [inside, outside]);
    expect(html).toContain("Inside Week");
    expect(html).not.toContain("Outside Week");
  });

  it("this-month filter hides tournaments outside March", () => {
    // now = 2026-03-10; month window = Mar 1 – Mar 31
    const inside = makeTournament({
      id: "m1",
      name: "Inside Month",
      start_date: "2026-03-15",
      end_date: "2026-03-20",
    });
    const outside = makeTournament({
      id: "m2",
      name: "Outside Month",
      start_date: "2026-04-01",
      end_date: "2026-04-05",
    });
    const html = renderWithDateFilter("this-month", [inside, outside]);
    expect(html).toContain("Inside Month");
    expect(html).not.toContain("Outside Month");
  });

  it("next-month filter hides tournaments not in April", () => {
    // now = 2026-03-10; next month window = Apr 1 – Apr 30
    const inside = makeTournament({
      id: "n1",
      name: "Inside Next Month",
      start_date: "2026-04-10",
      end_date: "2026-04-15",
    });
    const outside = makeTournament({
      id: "n2",
      name: "Outside Next Month",
      start_date: "2026-03-15",
      end_date: "2026-03-20",
    });
    const html = renderWithDateFilter("next-month", [inside, outside]);
    expect(html).toContain("Inside Next Month");
    expect(html).not.toContain("Outside Next Month");
  });
});

// ── Combined filters ──────────────────────────────────────────

describe("combined filters", () => {
  const tournaments = [
    makeTournament({
      id: "1",
      name: "KL Blitz",
      state: "W.P. Kuala Lumpur",
      format: { type: "blitz", system: "swiss", rounds: 9 },
      is_fide_rated: true,
      is_mcf_rated: false,
      start_date: "2026-03-12",
      end_date: "2026-03-12",
    }),
    makeTournament({
      id: "2",
      name: "Selangor Rapid",
      state: "Selangor",
      format: { type: "rapid", system: "swiss", rounds: 7 },
      is_fide_rated: false,
      is_mcf_rated: true,
      start_date: "2026-03-15",
      end_date: "2026-03-16",
    }),
    makeTournament({
      id: "3",
      name: "Johor Classical",
      state: "Johor",
      format: { type: "classical", system: "swiss", rounds: 5 },
      is_fide_rated: false,
      is_mcf_rated: false,
      start_date: "2026-04-05",
      end_date: "2026-04-07",
    }),
  ];

  it("applies search and state filters together", () => {
    const result = filterTournaments(tournaments, {
      search: "KL",
      states: ["W.P. Kuala Lumpur"],
    });
    expect(result.map((t) => t.name)).toEqual(["KL Blitz"]);
  });

  it("applies format, rating, and date filters together", () => {
    const result = filterTournaments(tournaments, {
      formats: ["rapid"],
      ratings: ["mcf"],
      dateFilter: "this-month",
      now: NOW,
    });
    expect(result.map((t) => t.name)).toEqual(["Selangor Rapid"]);
  });

  it("returns empty when filters produce no match", () => {
    const result = filterTournaments(tournaments, {
      formats: ["blitz"],
      states: ["Johor"],
    });
    expect(result).toHaveLength(0);
  });
});
