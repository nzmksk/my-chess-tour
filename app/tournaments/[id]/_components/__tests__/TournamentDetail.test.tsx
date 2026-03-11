import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TournamentDetail from "../TournamentDetail";
import type { TournamentDetail as TournamentDetailType } from "../../types";

// ── Fixtures ─────────────────────────────────────────────────

const base: TournamentDetailType = {
  id: "t1",
  name: "KL Open Rapid Championship 2026",
  description: "Annual rapid chess championship in Kuala Lumpur.",
  venue_name: "Dewan Bandaraya KL",
  state: "W.P. Kuala Lumpur",
  venue_address: "Jalan Raja Laut, 50350 Kuala Lumpur",
  start_date: "2026-06-01",
  end_date: "2026-06-02",
  registration_deadline: "2026-05-28T23:59:59Z",
  format: { type: "rapid", system: "swiss", rounds: 7 },
  time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 0 },
  is_fide_rated: true,
  is_mcf_rated: false,
  entry_fees: {
    standard: { amount_cents: 5000 },
    additional: [
      { type: "Early Bird", amount_cents: 3500, valid_until: "2026-05-01" },
    ],
  },
  prizes: {
    categories: [
      {
        name: "Open",
        entries: [
          { place: "1st Place", amount_cents: 300000 },
          { place: "2nd Place", amount_cents: 200000 },
          { place: "3rd Place", amount_cents: 100000 },
        ],
      },
    ],
  },
  restrictions: {
    min_rating: null,
    max_rating: 2200,
    min_age: null,
    max_age: null,
  },
  max_participants: 120,
  current_participants: 78,
  status: "published",
  organizer: {
    id: "org-1",
    organization_name: "KL Chess Association",
    description: "Premier chess organization in KL.",
    links: [{ url: "https://klchess.org", label: "Website" }],
    email: "info@klchess.org",
    phone: "+60123456789",
  },
};

function render(overrides: Partial<TournamentDetailType> = {}): string {
  return renderToStaticMarkup(
    <TournamentDetail tournament={{ ...base, ...overrides }} />,
  );
}

// ── Tournament header ─────────────────────────────────────────

describe("tournament header", () => {
  it("renders the tournament name", () => {
    const html = render();
    expect(html).toContain("KL Open Rapid Championship 2026");
  });

  it("renders the organizer name when organizer is present", () => {
    const html = render();
    expect(html).toContain("KL Chess Association");
  });

  it("does not render organizer line when organizer is null", () => {
    const html = render({ organizer: null });
    expect(html).not.toContain("Organized by");
  });
});

// ── Rating badges ─────────────────────────────────────────────

describe("rating badges", () => {
  it("shows FIDE badge when FIDE rated", () => {
    const html = render({ is_fide_rated: true, is_mcf_rated: false });
    expect(html).toContain("FIDE");
  });

  it("shows MCF badge when MCF rated", () => {
    const html = render({ is_fide_rated: false, is_mcf_rated: true });
    expect(html).toContain("MCF");
  });

  it("shows Unrated badge when neither FIDE nor MCF rated", () => {
    const html = render({ is_fide_rated: false, is_mcf_rated: false });
    expect(html).toContain("Unrated");
  });
});

// ── Tournament details section ────────────────────────────────

describe("tournament details section", () => {
  it("renders the venue name and state", () => {
    const html = render();
    expect(html).toContain("Dewan Bandaraya KL");
    expect(html).toContain("W.P. Kuala Lumpur");
  });

  it("renders the format type and rounds", () => {
    const html = render();
    expect(html).toContain("Rapid");
    expect(html).toContain("7");
  });

  it("renders the time control with increment", () => {
    const html = render();
    expect(html).toContain("15 min");
    expect(html).toContain("10 sec");
  });

  it("renders time control without increment when increment is 0", () => {
    const html = render({
      time_control: { base_minutes: 90, increment_seconds: 0, delay_seconds: 0 },
    });
    expect(html).toContain("90 min");
    expect(html).not.toContain("+ 0 sec");
  });

  it("renders capacity with spots remaining", () => {
    const html = render({ max_participants: 120, current_participants: 78 });
    expect(html).toContain("120");
    expect(html).toContain("42");
  });

  it("renders date range when start and end differ", () => {
    const html = render({ start_date: "2026-06-01", end_date: "2026-06-02" });
    expect(html).toContain("–");
  });

  it("renders single date when start and end are the same", () => {
    const html = render({ start_date: "2026-06-01", end_date: "2026-06-01" });
    expect(html).not.toContain("–");
  });

  it("renders the venue address when present", () => {
    const html = render();
    expect(html).toContain("Jalan Raja Laut");
  });

  it("omits venue address when not present", () => {
    const html = render({ venue_address: null });
    expect(html).not.toContain("Jalan Raja Laut");
  });
});

// ── Entry fees section ────────────────────────────────────────

describe("entry fees section", () => {
  it("renders the standard fee", () => {
    const html = render({ entry_fees: { standard: { amount_cents: 5000 } } });
    expect(html).toContain("RM50");
  });

  it("renders 'Free' for zero standard fee", () => {
    const html = render({ entry_fees: { standard: { amount_cents: 0 } } });
    expect(html).toContain("Free");
  });

  it("renders additional fee tiers when present", () => {
    const html = render();
    expect(html).toContain("Early Bird");
    expect(html).toContain("RM35");
  });

  it("omits additional fees section when not present", () => {
    const html = render({ entry_fees: { standard: { amount_cents: 5000 } } });
    expect(html).not.toContain("Early Bird");
  });
});

// ── Prizes section ────────────────────────────────────────────

describe("prizes section", () => {
  it("renders prizes section when prizes are present", () => {
    const html = render();
    expect(html).toContain("Prizes");
    expect(html).toContain("1st Place");
    expect(html).toContain("RM3,000");
  });

  it("renders prize category headers", () => {
    const html = render();
    expect(html).toContain("Open");
  });

  it("hides prizes section when prizes are null", () => {
    const html = render({ prizes: null });
    expect(html).not.toContain("1st Place");
  });

  it("renders multiple categories when provided", () => {
    const html = render({
      prizes: {
        categories: [
          {
            name: "Open",
            entries: [{ place: "1st Place", amount_cents: 300000 }],
          },
          {
            name: "Under-12",
            entries: [{ place: "1st Place", amount_cents: 50000 }],
          },
        ],
      },
    });
    expect(html).toContain("Open");
    expect(html).toContain("Under-12");
  });
});

// ── Restrictions section ──────────────────────────────────────

describe("restrictions section", () => {
  it("renders restrictions section when restrictions are present", () => {
    const html = render({ restrictions: { max_rating: 2200 } });
    expect(html).toContain("2200");
  });

  it("hides restrictions section when restrictions are null", () => {
    const html = render({ restrictions: null });
    // Section header should not appear when no restrictions
    expect(html).not.toContain("Restrictions");
  });

  it("shows 'Open to all' when all restriction fields are null/absent", () => {
    const html = render({
      restrictions: {
        min_rating: null,
        max_rating: null,
        min_age: null,
        max_age: null,
      },
    });
    expect(html).toContain("Open to all");
  });

  it("renders min and max rating when both are set", () => {
    const html = render({
      restrictions: { min_rating: 1200, max_rating: 2200 },
    });
    expect(html).toContain("1200");
    expect(html).toContain("2200");
  });

  it("renders max age restriction when set", () => {
    const html = render({
      restrictions: { min_rating: null, max_rating: null, min_age: null, max_age: 18 },
    });
    expect(html).toContain("18");
  });
});

// ── Description section ───────────────────────────────────────

describe("description section", () => {
  it("renders description when present", () => {
    const html = render();
    expect(html).toContain("Annual rapid chess championship in Kuala Lumpur.");
  });

  it("hides description section when description is null", () => {
    const html = render({ description: null });
    expect(html).not.toContain("Annual rapid chess championship");
  });
});

// ── Organizer section ─────────────────────────────────────────

describe("organizer section", () => {
  it("renders organizer description when present", () => {
    const html = render();
    expect(html).toContain("Premier chess organization in KL.");
  });

  it("renders organizer email", () => {
    const html = render();
    expect(html).toContain("info@klchess.org");
  });

  it("renders organizer phone when present", () => {
    const html = render();
    expect(html).toContain("+60123456789");
  });

  it("omits phone when not present", () => {
    const html = render({
      organizer: { ...base.organizer!, phone: null },
    });
    expect(html).not.toContain("+60123456789");
  });

  it("hides organizer section when organizer is null", () => {
    const html = render({ organizer: null });
    expect(html).not.toContain("info@klchess.org");
  });

  it("renders organizer links when present as array", () => {
    const html = render();
    expect(html).toContain("Website");
  });
});

// ── Register card (sidebar) ───────────────────────────────────

describe("register card", () => {
  it("shows the lowest applicable fee in the register card", () => {
    const html = render();
    // Early Bird at RM35 is lower than standard RM50
    expect(html).toContain("RM35");
  });

  it("shows spots remaining", () => {
    const html = render({ max_participants: 120, current_participants: 78 });
    expect(html).toContain("42");
  });

  it("shows full status when no spots remain", () => {
    const html = render({ max_participants: 100, current_participants: 100 });
    expect(html).toContain("Full");
  });

  it("shows registration deadline", () => {
    const html = render();
    expect(html).toContain("28 May");
  });
});
