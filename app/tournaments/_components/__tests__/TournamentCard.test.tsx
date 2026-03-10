import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TournamentCard from "../TournamentCard";
import type { Tournament } from "../../types";

const base: Tournament = {
  id: "1",
  name: "Test Tournament",
  venue_name: "Test Venue",
  state: "Selangor",
  start_date: "2026-06-01",
  end_date: "2026-06-02",
  registration_deadline: "2026-05-31",
  format: { type: "rapid", system: "swiss", rounds: 7 },
  time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 0 },
  is_fide_rated: false,
  is_mcf_rated: false,
  entry_fees: { standard: { amount_cents: 5000 } },
  max_participants: 100,
  current_participants: 50,
  status: "published",
  organizer: null,
};

function render(overrides: Partial<Tournament>) {
  return renderToStaticMarkup(
    <TournamentCard tournament={{ ...base, ...overrides }} />,
  );
}

// ── Spots badge ──────────────────────────────────────────────

describe("spots badge", () => {
  it("shows available state when spots remain above 20%", () => {
    const html = render({ max_participants: 100, current_participants: 50 });
    expect(html).toContain("spots-available");
    expect(html).toContain("50 spots left");
  });

  it("uses singular 'spot' when exactly 1 remains", () => {
    const html = render({ max_participants: 100, current_participants: 99 });
    expect(html).toContain("1 spot left");
  });

  it("shows low state when spots ratio is at or below 20%", () => {
    const html = render({ max_participants: 100, current_participants: 80 });
    expect(html).toContain("spots-low");
    expect(html).toContain("20 spots left");
  });

  it("shows full state when no spots remain", () => {
    const html = render({ max_participants: 100, current_participants: 100 });
    expect(html).toContain("spots-full");
    expect(html).toContain("card-btn-full");
    expect(html).not.toContain("card-btn-view");
  });
});

// ── Date range ───────────────────────────────────────────────

describe("date range", () => {
  it("renders a single date when start and end are the same day", () => {
    const html = render({ start_date: "2026-06-01", end_date: "2026-06-01" });
    // Should not contain the en-dash separator used for ranges
    expect(html).not.toContain("–");
  });

  it("renders a date range when start and end differ", () => {
    const html = render({ start_date: "2026-06-01", end_date: "2026-06-03" });
    expect(html).toContain("–");
  });
});

// ── Entry fee ────────────────────────────────────────────────

describe("entry fee", () => {
  it("shows formatted price", () => {
    const html = render({ entry_fees: { standard: { amount_cents: 3000 } } });
    expect(html).toContain("RM30");
  });

  it("shows Free when entry fee is zero", () => {
    const html = render({ entry_fees: { standard: { amount_cents: 0 } } });
    expect(html).toContain("Free");
  });

  it("shows 'starting from' label when multiple fees exist", () => {
    const html = render({
      entry_fees: {
        standard: { amount_cents: 5000 },
        additional: [{ type: "u18", amount_cents: 3000 }],
      },
    });
    expect(html).toContain("starting from");
  });

  it("omits 'starting from' label for single fee", () => {
    const html = render({ entry_fees: { standard: { amount_cents: 5000 } } });
    expect(html).not.toContain("starting from");
  });
});

// ── Rating badges ────────────────────────────────────────────

describe("rating badges", () => {
  it("shows FIDE badge when FIDE rated", () => {
    const html = render({ is_fide_rated: true, is_mcf_rated: false });
    expect(html).toContain("badge-fide");
    expect(html).not.toContain("badge-unrated");
  });

  it("shows MCF badge when MCF rated", () => {
    const html = render({ is_fide_rated: false, is_mcf_rated: true });
    expect(html).toContain("badge-mcf");
    expect(html).not.toContain("badge-unrated");
  });

  it("shows unrated badge when neither FIDE nor MCF", () => {
    const html = render({ is_fide_rated: false, is_mcf_rated: false });
    expect(html).toContain("badge-unrated");
  });
});

// ── Time control ─────────────────────────────────────────────

describe("time control", () => {
  it("renders base minutes and increment", () => {
    const html = render({
      time_control: {
        base_minutes: 15,
        increment_seconds: 10,
        delay_seconds: 0,
      },
    });
    expect(html).toContain("15 min + 10 sec");
  });

  it("renders base minutes without increment when increment is 0", () => {
    const html = render({
      time_control: {
        base_minutes: 90,
        increment_seconds: 0,
        delay_seconds: 0,
      },
    });
    expect(html).toContain("90 min");
    expect(html).not.toContain("+ 0 sec");
  });

  it("renders Swiss rounds when no time control is set", () => {
    const html = render({ time_control: undefined });
    expect(html).toContain("Swiss · 7 rounds");
  });
});
