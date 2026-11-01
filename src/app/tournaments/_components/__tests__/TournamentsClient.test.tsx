/* eslint-disable @next/next/no-img-element */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TournamentsClient from "../TournamentsClient";
import type { Tournament } from "../../types";
import {
  addCalendarDays,
  endOfMonth,
  getTodayInTimeZone,
  startOfMonth,
} from "@/lib/datetime";

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
  // Map of useState call index (1-based) → injected initial value.
  let _overridesMap: Record<number, unknown> = {};
  // Expose setters so tests can drive the behavior:
  (globalThis as Record<string, unknown>).__setReactUseStateOverride = (
    v: string | null,
  ) => {
    _override = v;
    _callCount = 0;
  };
  (globalThis as Record<string, unknown>).__resetReactUseStateCounter = () => {
    _callCount = 0;
  };
  // General-purpose override: keys are 1-based useState call indices.
  // useState call order in TournamentsClient: 1=search, 2=formats, 3=states, 4=ratings, 5=dateFilter
  (globalThis as Record<string, unknown>).__setReactUseStateOverrides = (
    map: Record<number, unknown>,
  ) => {
    _overridesMap = { ...map };
    _callCount = 0;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrappedUseState = (initial: any) => {
    _callCount += 1;
    if (_callCount in _overridesMap) {
      return actual.useState(_overridesMap[_callCount]);
    }
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

type TestGlobal = typeof globalThis & {
  __setReactUseStateOverride: (v: string | null) => void;
  __resetReactUseStateCounter: () => void;
  __setReactUseStateOverrides: (map: Record<number, unknown>) => void;
};

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
    slug: "default-tournament",
    name: "Default Tournament",
    venue: { name: "Test Venue", state: "Selangor" },
    timezone: "Asia/Kuala_Lumpur",
    start_date: "2026-08-10",
    end_date: "2026-08-10",
    registration_deadline: "2026-08-09",
    format: { type: "rapid", system: "swiss", rounds: 7 },
    time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 0 },
    is_fide_rated: false,
    is_mcf_rated: false,
    entry_fees: { standard: { amount_cents: 5000 } },
    max_participants: 100,
    current_participants: 50,
    status: "published",
    organizer: null,
    ...overrides,
  };
}

/**
 * Mirrors the filter logic in TournamentsClient so the filtering behaviour
 * can be tested as a pure function without needing jsdom to drive state.
 * Keep in sync with the useMemo block in TournamentsClient.tsx — including its
 * `today`, which the component derives per tournament from its venue timezone.
 */
function filterTournaments(
  tournaments: Tournament[],
  {
    search = "",
    formats = [] as string[],
    states = [] as string[],
    ratings = [] as string[],
    dateFilter = "any",
    today = getTodayInTimeZone(),
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

    if (states.length > 0 && !states.includes(t.venue.state)) return false;

    if (ratings.length > 0) {
      const matchFide = ratings.includes("fide") && t.is_fide_rated;
      const matchMcf = ratings.includes("mcf") && t.is_mcf_rated;
      const matchUnrated =
        ratings.includes("unrated") && !t.is_fide_rated && !t.is_mcf_rated;
      if (!matchFide && !matchMcf && !matchUnrated) return false;
    }

    if (dateFilter === "this-week") {
      if (t.start_date > addCalendarDays(today, 7) || t.end_date < today)
        return false;
    } else if (dateFilter === "this-month") {
      if (t.start_date > endOfMonth(today) || t.end_date < startOfMonth(today))
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
}

// Fixed "today" used across all date-filter tests
const TODAY = "2026-03-10";

// ── Initial render (smoke test) ───────────────────────────────

describe("initial render", () => {
  it("renders all tournaments when no filters are applied", () => {
    const tournaments = [
      makeTournament({ id: "1", name: "Alpha" }),
      makeTournament({ id: "2", name: "Beta" }),
    ];
    const html = renderToStaticMarkup(
      <TournamentsClient
        tournaments={tournaments}
        now={"2026-01-01T04:00:00Z"}
      />,
    );
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
  });

  it("renders empty-state message when no tournaments are provided", () => {
    const html = renderToStaticMarkup(
      <TournamentsClient tournaments={[]} now={"2026-01-01T04:00:00Z"} />,
    );
    expect(html).toContain("No tournaments are currently published.");
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
    expect(result.map((t) => t.name)).not.toContain(
      "KL Rapid Chess Championship",
    );
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
    makeTournament({
      id: "1",
      name: "Blitz",
      format: { type: "blitz", system: "swiss", rounds: 9 },
    }),
    makeTournament({
      id: "2",
      name: "Rapid",
      format: { type: "rapid", system: "swiss", rounds: 7 },
    }),
    makeTournament({
      id: "3",
      name: "Classical",
      format: { type: "classical", system: "swiss", rounds: 5 },
    }),
  ];

  it("includes only tournaments matching the selected format", () => {
    const result = filterTournaments(tournaments, { formats: ["blitz"] });
    expect(result.map((t) => t.name)).toEqual(["Blitz"]);
  });

  it("supports multiple selected formats", () => {
    const result = filterTournaments(tournaments, {
      formats: ["blitz", "rapid"],
    });
    expect(result.map((t) => t.name)).toEqual(["Blitz", "Rapid"]);
  });

  it("is case-insensitive when matching format types", () => {
    const t = makeTournament({
      format: { type: "Rapid", system: "swiss", rounds: 7 },
    });
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
    makeTournament({
      id: "1",
      name: "Johor Open",
      venue: { name: "Test Venue", state: "Johor" },
    }),
    makeTournament({
      id: "2",
      name: "Selangor Open",
      venue: { name: "Test Venue", state: "Selangor" },
    }),
    makeTournament({
      id: "3",
      name: "Perak Open",
      venue: { name: "Test Venue", state: "Perak" },
    }),
  ];

  it("includes only tournaments in the selected state", () => {
    const result = filterTournaments(tournaments, { states: ["Selangor"] });
    expect(result.map((t) => t.name)).toEqual(["Selangor Open"]);
  });

  it("supports multiple selected states", () => {
    const result = filterTournaments(tournaments, {
      states: ["Johor", "Perak"],
    });
    expect(result.map((t) => t.name)).toEqual(["Johor Open", "Perak Open"]);
  });

  it("returns all tournaments when no states are selected", () => {
    const result = filterTournaments(tournaments, { states: [] });
    expect(result).toHaveLength(3);
  });
});

// ── Rating filter ─────────────────────────────────────────────

describe("rating filter", () => {
  const fide = makeTournament({
    id: "1",
    name: "FIDE",
    is_fide_rated: true,
    is_mcf_rated: false,
  });
  const mcf = makeTournament({
    id: "2",
    name: "MCF",
    is_fide_rated: false,
    is_mcf_rated: true,
  });
  const both = makeTournament({
    id: "3",
    name: "Both",
    is_fide_rated: true,
    is_mcf_rated: true,
  });
  const unrated = makeTournament({
    id: "4",
    name: "Unrated",
    is_fide_rated: false,
    is_mcf_rated: false,
  });
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
    const t = makeTournament({
      start_date: "2026-03-10",
      end_date: "2026-03-10",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-week", today: TODAY }),
    ).toHaveLength(1);
  });

  it("includes a tournament fully within the next 7 days", () => {
    const t = makeTournament({
      start_date: "2026-03-12",
      end_date: "2026-03-14",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-week", today: TODAY }),
    ).toHaveLength(1);
  });

  it("includes a tournament that started before today but ends within next 7 days", () => {
    const t = makeTournament({
      start_date: "2026-03-08",
      end_date: "2026-03-11",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-week", today: TODAY }),
    ).toHaveLength(1);
  });

  it("includes a tournament that starts within the window but ends after it", () => {
    // window: 2026-03-10 to 2026-03-17; tournament starts inside, ends outside → overlaps
    const t = makeTournament({
      start_date: "2026-03-15",
      end_date: "2026-03-20",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-week", today: TODAY }),
    ).toHaveLength(1);
  });

  it("excludes a tournament that ended before today", () => {
    const t = makeTournament({
      start_date: "2026-03-01",
      end_date: "2026-03-09",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-week", today: TODAY }),
    ).toHaveLength(0);
  });

  it("excludes a tournament starting after the 7-day window", () => {
    const t = makeTournament({
      start_date: "2026-03-18",
      end_date: "2026-03-20",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-week", today: TODAY }),
    ).toHaveLength(0);
  });

  it("includes a tournament starting on exactly the last day of the window (boundary)", () => {
    // window: 2026-03-10 to 2026-03-17; start on Mar 17 must be included
    const t = makeTournament({
      start_date: "2026-03-17",
      end_date: "2026-03-17",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-week", today: TODAY }),
    ).toHaveLength(1);
  });
});

describe("date filter — this-month (now = 2026-03-10, month = March)", () => {
  it("includes a tournament fully within this month", () => {
    const t = makeTournament({
      start_date: "2026-03-15",
      end_date: "2026-03-20",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-month", today: TODAY }),
    ).toHaveLength(1);
  });

  it("includes a tournament spanning from last month into this month", () => {
    const t = makeTournament({
      start_date: "2026-02-25",
      end_date: "2026-03-05",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-month", today: TODAY }),
    ).toHaveLength(1);
  });

  it("includes a tournament spanning from this month into next month", () => {
    const t = makeTournament({
      start_date: "2026-03-28",
      end_date: "2026-04-05",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-month", today: TODAY }),
    ).toHaveLength(1);
  });

  it("excludes a tournament fully in the previous month", () => {
    const t = makeTournament({
      start_date: "2026-02-01",
      end_date: "2026-02-28",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-month", today: TODAY }),
    ).toHaveLength(0);
  });

  it("excludes a tournament fully in the next month", () => {
    const t = makeTournament({
      start_date: "2026-04-01",
      end_date: "2026-04-10",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-month", today: TODAY }),
    ).toHaveLength(0);
  });

  it("includes a tournament starting on the last day of the month (boundary)", () => {
    // window end: 2026-03-31; start on Mar 31 must be included
    const t = makeTournament({
      start_date: "2026-03-31",
      end_date: "2026-03-31",
    });
    expect(
      filterTournaments([t], { dateFilter: "this-month", today: TODAY }),
    ).toHaveLength(1);
  });
});

describe("date filter — next-month (now = 2026-03-10, next month = April)", () => {
  it("includes a tournament fully within next month", () => {
    const t = makeTournament({
      start_date: "2026-04-10",
      end_date: "2026-04-15",
    });
    expect(
      filterTournaments([t], { dateFilter: "next-month", today: TODAY }),
    ).toHaveLength(1);
  });

  it("includes a tournament spanning from this month into next month", () => {
    const t = makeTournament({
      start_date: "2026-03-28",
      end_date: "2026-04-05",
    });
    expect(
      filterTournaments([t], { dateFilter: "next-month", today: TODAY }),
    ).toHaveLength(1);
  });

  it("includes a tournament spanning from next month into the month after", () => {
    const t = makeTournament({
      start_date: "2026-04-28",
      end_date: "2026-05-03",
    });
    expect(
      filterTournaments([t], { dateFilter: "next-month", today: TODAY }),
    ).toHaveLength(1);
  });

  it("excludes a tournament fully in the current month", () => {
    const t = makeTournament({
      start_date: "2026-03-01",
      end_date: "2026-03-31",
    });
    expect(
      filterTournaments([t], { dateFilter: "next-month", today: TODAY }),
    ).toHaveLength(0);
  });

  it("excludes a tournament fully two months ahead", () => {
    const t = makeTournament({
      start_date: "2026-05-01",
      end_date: "2026-05-10",
    });
    expect(
      filterTournaments([t], { dateFilter: "next-month", today: TODAY }),
    ).toHaveLength(0);
  });

  it("includes a tournament starting on the last day of next month (boundary)", () => {
    // window end: 2026-04-30; start on Apr 30 must be included
    const t = makeTournament({
      start_date: "2026-04-30",
      end_date: "2026-04-30",
    });
    expect(
      filterTournaments([t], { dateFilter: "next-month", today: TODAY }),
    ).toHaveLength(1);
  });
});

describe("date filter — any", () => {
  it("returns all tournaments regardless of date", () => {
    const tournaments = [
      makeTournament({ start_date: "2025-01-01", end_date: "2025-01-05" }),
      makeTournament({ start_date: "2026-03-10", end_date: "2026-03-10" }),
      makeTournament({ start_date: "2027-12-01", end_date: "2027-12-31" }),
    ];
    const result = filterTournaments(tournaments, {
      dateFilter: "any",
      today: TODAY,
    });
    expect(result).toHaveLength(3);
  });
});

// ── Helpers (component-level renders with injected state) ─────
//
// useState call order in TournamentsClient:
//   1. search     → ""
//   2. formats    → []
//   3. states     → []
//   4. ratings    → []
//   5. dateFilter → "any"

function renderWithFilters(
  overrides: {
    search?: string;
    formats?: string[];
    states?: string[];
    ratings?: string[];
    dateFilter?: string;
  },
  tournaments: Tournament[],
): string {
  const map: Record<number, unknown> = {};
  if (overrides.search !== undefined) map[1] = overrides.search;
  if (overrides.formats !== undefined) map[2] = overrides.formats;
  if (overrides.states !== undefined) map[3] = overrides.states;
  if (overrides.ratings !== undefined) map[4] = overrides.ratings;
  if (overrides.dateFilter !== undefined) map[5] = overrides.dateFilter;

  (globalThis as TestGlobal).__setReactUseStateOverrides(map);
  try {
    return renderToStaticMarkup(
      <TournamentsClient
        tournaments={tournaments}
        now={"2026-01-01T04:00:00Z"}
      />,
    );
  } finally {
    (globalThis as TestGlobal).__setReactUseStateOverrides({});
  }
}

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
    (globalThis as TestGlobal).__setReactUseStateOverride(dateFilter);
    try {
      return renderToStaticMarkup(
        <TournamentsClient
          tournaments={tournaments}
          now={"2026-03-10T04:00:00Z"}
        />,
      );
    } finally {
      // Disarm for subsequent tests
      (globalThis as TestGlobal).__setReactUseStateOverride(null);
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
      venue: { name: "Test Venue", state: "W.P. Kuala Lumpur" },
      format: { type: "blitz", system: "swiss", rounds: 9 },
      is_fide_rated: true,
      is_mcf_rated: false,
      start_date: "2026-03-12",
      end_date: "2026-03-12",
    }),
    makeTournament({
      id: "2",
      name: "Selangor Rapid",
      venue: { name: "Test Venue", state: "Selangor" },
      format: { type: "rapid", system: "swiss", rounds: 7 },
      is_fide_rated: false,
      is_mcf_rated: true,
      start_date: "2026-03-15",
      end_date: "2026-03-16",
    }),
    makeTournament({
      id: "3",
      name: "Johor Classical",
      venue: { name: "Test Venue", state: "Johor" },
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
      today: TODAY,
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

// ── Component-level filter branches ───────────────────────────
//
// These tests render TournamentsClient with injected filter state to cover
// the return-false branches inside useMemo that are unreachable via the
// pure filterTournaments helper (lines 44-46, 55, 60, 65-69).

describe("search filter — component level", () => {
  it("shows matching tournament and hides non-matching one", () => {
    const matching = makeTournament({ id: "1", name: "Selangor Open" });
    const nonMatching = makeTournament({ id: "2", name: "KL Rapid" });
    const html = renderWithFilters({ search: "selangor" }, [
      matching,
      nonMatching,
    ]);
    expect(html).toContain("Selangor Open");
    expect(html).not.toContain("KL Rapid");
  });

  it("shows 'no match' message when search excludes all tournaments", () => {
    const t = makeTournament({ name: "KL Rapid" });
    const html = renderWithFilters({ search: "xyz" }, [t]);
    expect(html).toContain("No tournaments match your current filters.");
  });
});

describe("format filter — component level", () => {
  it("shows matching format and hides non-matching one", () => {
    const blitz = makeTournament({
      id: "1",
      name: "Blitz Open",
      format: { type: "blitz", system: "swiss", rounds: 9 },
    });
    const rapid = makeTournament({
      id: "2",
      name: "Rapid Open",
      format: { type: "rapid", system: "swiss", rounds: 7 },
    });
    const html = renderWithFilters({ formats: ["blitz"] }, [blitz, rapid]);
    expect(html).toContain("Blitz Open");
    expect(html).not.toContain("Rapid Open");
  });

  it("shows 'no match' message when format excludes all tournaments", () => {
    const t = makeTournament({
      format: { type: "classical", system: "swiss", rounds: 5 },
    });
    const html = renderWithFilters({ formats: ["blitz"] }, [t]);
    expect(html).toContain("No tournaments match your current filters.");
  });
});

describe("state filter — component level", () => {
  it("shows matching state and hides non-matching one", () => {
    const johor = makeTournament({
      id: "1",
      name: "Johor Open",
      venue: { name: "Test Venue", state: "Johor" },
    });
    const selangor = makeTournament({
      id: "2",
      name: "Selangor Open",
      venue: { name: "Test Venue", state: "Selangor" },
    });
    const html = renderWithFilters({ states: ["Johor"] }, [johor, selangor]);
    expect(html).toContain("Johor Open");
    expect(html).not.toContain("Selangor Open");
  });

  it("shows 'no match' message when state excludes all tournaments", () => {
    const t = makeTournament({
      venue: { name: "Test Venue", state: "Selangor" },
    });
    const html = renderWithFilters({ states: ["Johor"] }, [t]);
    expect(html).toContain("No tournaments match your current filters.");
  });
});

describe("rating filter — component level", () => {
  const fide = makeTournament({
    id: "1",
    name: "FIDE Open",
    is_fide_rated: true,
    is_mcf_rated: false,
  });
  const mcf = makeTournament({
    id: "2",
    name: "MCF Open",
    is_fide_rated: false,
    is_mcf_rated: true,
  });
  const unrated = makeTournament({
    id: "3",
    name: "Unrated Open",
    is_fide_rated: false,
    is_mcf_rated: false,
  });

  it("shows FIDE-rated tournament when 'fide' is selected", () => {
    const html = renderWithFilters({ ratings: ["fide"] }, [fide, unrated]);
    expect(html).toContain("FIDE Open");
    expect(html).not.toContain("Unrated Open");
  });

  it("shows MCF-rated tournament when 'mcf' is selected", () => {
    const html = renderWithFilters({ ratings: ["mcf"] }, [mcf, unrated]);
    expect(html).toContain("MCF Open");
    expect(html).not.toContain("Unrated Open");
  });

  it("shows unrated tournament when 'unrated' is selected", () => {
    const html = renderWithFilters({ ratings: ["unrated"] }, [unrated, fide]);
    expect(html).toContain("Unrated Open");
    expect(html).not.toContain("FIDE Open");
  });

  it("shows 'no match' message when rating excludes all tournaments", () => {
    const html = renderWithFilters({ ratings: ["fide"] }, [unrated]);
    expect(html).toContain("No tournaments match your current filters.");
  });

  it("shows both FIDE and MCF tournaments when both ratings are selected", () => {
    const html = renderWithFilters({ ratings: ["fide", "mcf"] }, [
      fide,
      mcf,
      unrated,
    ]);
    expect(html).toContain("FIDE Open");
    expect(html).toContain("MCF Open");
    expect(html).not.toContain("Unrated Open");
  });
});

// ── Tournament categorisation ─────────────────────────────────
//
// These tests verify that tournaments are grouped into the correct sections
// (Ongoing / Upcoming / Past Tournaments) and that past ones carry the
// dimmed class. Fixed "now" = 2026-05-23 via fake timers.

describe("tournament categorisation — component level", () => {
  // Fixed "now": 2026-05-23
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 23)); // month is 0-indexed → 4 = May
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("places a currently-running tournament in the Ongoing section", () => {
    const t = makeTournament({
      name: "Live Open",
      start_date: "2026-05-20",
      end_date: "2026-05-25",
    });
    const html = renderToStaticMarkup(
      <TournamentsClient tournaments={[t]} now={"2026-05-23T04:00:00Z"} />,
    );
    expect(html).toContain("Ongoing");
    expect(html).toContain("Live Open");
    expect(html).not.toContain("Upcoming");
    expect(html).not.toContain("Past Tournaments");
  });

  it("places a future tournament in the Upcoming section", () => {
    const t = makeTournament({
      name: "Future Open",
      start_date: "2026-06-10",
      end_date: "2026-06-12",
    });
    const html = renderToStaticMarkup(
      <TournamentsClient tournaments={[t]} now={"2026-05-23T04:00:00Z"} />,
    );
    expect(html).toContain("Upcoming");
    expect(html).toContain("Future Open");
    expect(html).not.toContain("Ongoing");
    expect(html).not.toContain("Past Tournaments");
  });

  it("places a recently-ended tournament (this month) in the Past section with dimmed class", () => {
    // ended May 10 — within this calendar month (May 2026), so visible but dimmed
    const t = makeTournament({
      name: "Recent Past",
      start_date: "2026-05-08",
      end_date: "2026-05-10",
    });
    const html = renderToStaticMarkup(
      <TournamentsClient tournaments={[t]} now={"2026-05-23T04:00:00Z"} />,
    );
    expect(html).toContain("Past Tournaments");
    expect(html).toContain("Recent Past");
    expect(html).toContain("opacity-50");
    expect(html).not.toContain("Ongoing");
    expect(html).not.toContain("Upcoming");
  });

  it("places a tournament that ended ~20 days ago in the Past section", () => {
    // ended May 3 — 20 days before today, within the 30-day window → visible, dimmed
    const t = makeTournament({
      name: "Recently Ended",
      start_date: "2026-05-02",
      end_date: "2026-05-03",
    });
    const html = renderToStaticMarkup(
      <TournamentsClient tournaments={[t]} now={"2026-05-23T04:00:00Z"} />,
    );
    expect(html).toContain("Past Tournaments");
    expect(html).toContain("Recently Ended");
    expect(html).toContain("opacity-50");
  });

  it("hides a tournament that ended more than 30 days ago", () => {
    // ended April 13 — 40 days before today, past the 30-day window → hidden
    const t = makeTournament({
      name: "Old Tournament",
      start_date: "2026-04-12",
      end_date: "2026-04-13",
    });
    const html = renderToStaticMarkup(
      <TournamentsClient tournaments={[t]} now={"2026-05-23T04:00:00Z"} />,
    );
    expect(html).not.toContain("Old Tournament");
  });

  it("excludes a tournament with an invalid date and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = makeTournament({
      id: "bad",
      name: "Broken Date",
      start_date: "not-a-date",
      end_date: "also-bad",
    });
    const html = renderToStaticMarkup(
      <TournamentsClient tournaments={[t]} now={"2026-05-23T04:00:00Z"} />,
    );
    expect(html).not.toContain("Broken Date");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("renders multiple sections when ongoing, upcoming, and past all exist", () => {
    const live = makeTournament({
      id: "1",
      name: "Live Open",
      start_date: "2026-05-20",
      end_date: "2026-05-25",
    });
    const future = makeTournament({
      id: "2",
      name: "Future Open",
      start_date: "2026-06-10",
      end_date: "2026-06-12",
    });
    const recent = makeTournament({
      id: "3",
      name: "Recent Past",
      start_date: "2026-05-01",
      end_date: "2026-05-05",
    });
    const html = renderToStaticMarkup(
      <TournamentsClient
        tournaments={[live, future, recent]}
        now={"2026-05-23T04:00:00Z"}
      />,
    );
    expect(html).toContain("Ongoing");
    expect(html).toContain("Live Open");
    expect(html).toContain("Upcoming");
    expect(html).toContain("Future Open");
    expect(html).toContain("Past Tournaments");
    expect(html).toContain("Recent Past");
  });

  it("shows empty state when all tournaments are older than last calendar month", () => {
    const old = makeTournament({
      name: "Very Old",
      start_date: "2026-03-01",
      end_date: "2026-03-31",
    });
    const html = renderToStaticMarkup(
      <TournamentsClient tournaments={[old]} now={"2026-05-23T04:00:00Z"} />,
    );
    expect(html).not.toContain("Very Old");
    expect(html).toContain("No tournaments match your current filters.");
  });

  it("buckets each tournament against its own venue's day", () => {
    // 2026-05-23 17:00 UTC: already the 24th in Manila (UTC+8), still the 23rd
    // in Yangon (UTC+6:30). A one-day event on the 23rd is therefore over at
    // one venue and running at the other, at the very same instant.
    const manila = makeTournament({
      id: "mnl",
      name: "Manila One Day",
      timezone: "Asia/Manila",
      start_date: "2026-05-23",
      end_date: "2026-05-23",
    });
    const yangon = makeTournament({
      id: "rgn",
      name: "Yangon One Day",
      timezone: "Asia/Yangon",
      start_date: "2026-05-23",
      end_date: "2026-05-23",
    });
    const html = renderToStaticMarkup(
      <TournamentsClient
        tournaments={[manila, yangon]}
        now={"2026-05-23T17:00:00Z"}
      />,
    );
    const ongoingIndex = html.indexOf("Ongoing");
    const pastIndex = html.indexOf("Past Tournaments");
    expect(ongoingIndex).toBeGreaterThan(-1);
    expect(pastIndex).toBeGreaterThan(-1);
    // Yangon is still running (Ongoing section), Manila has finished (Past).
    expect(html.indexOf("Yangon One Day")).toBeGreaterThan(ongoingIndex);
    expect(html.indexOf("Yangon One Day")).toBeLessThan(pastIndex);
    expect(html.indexOf("Manila One Day")).toBeGreaterThan(pastIndex);
  });

  it("shows each tournament's dates in its own venue timezone", () => {
    const bangkok = makeTournament({
      id: "bkk",
      name: "Bangkok Open",
      timezone: "Asia/Bangkok",
      start_date: "2026-05-24",
      end_date: "2026-05-24",
    });
    const html = renderToStaticMarkup(
      <TournamentsClient
        tournaments={[bangkok]}
        now={"2026-05-23T04:00:00Z"}
      />,
    );
    expect(html).toContain("24 May 2026 (ICT)");
  });

  it("ongoing cards do not carry the dimmed class", () => {
    const t = makeTournament({
      name: "Live Open",
      start_date: "2026-05-20",
      end_date: "2026-05-25",
    });
    const html = renderToStaticMarkup(
      <TournamentsClient tournaments={[t]} now={"2026-05-23T04:00:00Z"} />,
    );
    expect(html).not.toContain("opacity-50");
  });
});
