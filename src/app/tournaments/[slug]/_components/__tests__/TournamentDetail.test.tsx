import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TournamentDetail from "../TournamentDetail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/tournaments/kl-open-rapid-2026",
  useSearchParams: () => ({ get: () => null, toString: () => "" }),
}));
import type { TournamentDetail as TournamentDetailType } from "../../types";
import type { StartingRankPlayer } from "../../types";

// ── Fixtures ─────────────────────────────────────────────────

const base: TournamentDetailType = {
  id: "t1",
  slug: "kl-open-rapid-2026",
  name: "KL Open Rapid Championship 2026",
  description: "Annual rapid chess championship in Kuala Lumpur.",
  venue: {
    name: "Dewan Bandaraya KL",
    state: "W.P. Kuala Lumpur",
    address: "Jalan Raja Laut, 50350 Kuala Lumpur",
  },
  timezone: "Asia/Kuala_Lumpur",
  start_date: "2026-06-01",
  end_date: "2026-06-02",
  registration_deadline: "2026-12-28T08:00:00Z",
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
  organization: {
    id: "org-1",
    name: "KL Chess Association",
    description: "Premier chess organization in KL.",
    links: [{ url: "https://klchess.org", label: "Website" }],
    email: "info@klchess.org",
    phone: "+60123456789",
  },
};

const samplePlayers: StartingRankPlayer[] = [
  {
    rank: 1,
    user_id: "u1",
    name: "Alice Wong",
    title: "WFM",
    fide_id: 123456,
    fide_rating: 2100,
    national_rating: null,
    nationality: "Malaysia",
    mcf_id: 10001,
    gender: "female",
  },
  {
    rank: 2,
    user_id: "u2",
    name: "Bob Lee",
    title: null,
    fide_id: null,
    fide_rating: null,
    national_rating: 1500,
    nationality: "Singapore",
    mcf_id: null,
    gender: "male",
  },
];

// Before the fixture's early bird ends (2026-05-01), so it is still open.
const NOW = "2026-04-01T00:00:00.000Z";

function render(
  overrides: Partial<TournamentDetailType> = {},
  isAuthenticated = false,
  registrationStatus: string | null = null,
  canViewStartingRank = false,
  startingRank: StartingRankPlayer[] | null = null,
  now: string = NOW,
): string {
  return renderToStaticMarkup(
    <TournamentDetail
      tournament={{ ...base, ...overrides }}
      isAuthenticated={isAuthenticated}
      registrationStatus={registrationStatus}
      canViewStartingRank={canViewStartingRank}
      startingRank={startingRank}
      now={now}
    />,
  );
}

// ── Tab structure ─────────────────────────────────────────────

describe("tab structure", () => {
  it("renders Tournament Details tab", () => {
    const html = render();
    expect(html).toContain("Tournament Details");
  });

  it("renders Starting Rank tab", () => {
    const html = render();
    expect(html).toContain("Starting Rank");
  });
});

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
    const html = render({ organization: null });
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
      time_control: {
        base_minutes: 90,
        increment_seconds: 0,
        delay_seconds: 0,
      },
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
    const html = render({ venue: { ...base.venue, address: null } });
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

  // The fee table, not the sidebar: the part of the page after its heading.
  const feeTable = (html: string) => {
    const start = html.indexOf("Entry Fees");
    return html.slice(start, html.indexOf("</table>", start));
  };

  it("lists fees from lowest to highest (#353)", () => {
    const html = feeTable(
      render({
        entry_fees: {
          standard: { amount_cents: 5000 },
          additional: [
            { type: "titled", amount_cents: 4500, titles: ["FM"] },
            { type: "junior", amount_cents: 2000, age_max: 18 },
            { type: "early_bird", amount_cents: 3500, valid_until: "2026-05-01T00:00:00Z" },
          ],
        },
      }),
    );
    const order = ["RM20.00", "RM35.00", "RM45.00", "RM50.00"].map((p) => html.indexOf(p));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("moves an ended tier to the end, struck through and marked ended", () => {
    const html = feeTable(render({}, false, null, false, null, "2026-06-01T00:00:00.000Z"));
    expect(html.indexOf("Standard")).toBeLessThan(html.indexOf("Early Bird"));
    expect(html).toContain("ended");
    expect(html).toContain("<s>RM35.00</s>");
    expect(html).not.toContain("before");
  });
});

// ── Register card price ───────────────────────────────────────

describe("register card price", () => {
  // The card is the aside; the price is its first figure.
  const card = (html: string) => html.slice(html.indexOf("Register for this tournament"));

  // The Selangor case from #258.
  const selangor = {
    entry_fees: {
      standard: { amount_cents: 4000 },
      additional: [
        { type: "early_bird", amount_cents: 3200, valid_until: "2026-05-01T00:00:00Z" },
        { type: "age_based", amount_cents: 2400, age_min: 0, age_max: 12 },
      ],
    },
  };

  it("leads with an early bird while it's open", () => {
    const html = card(render(selangor));
    expect(html).toContain("RM32.00");
    expect(html).toContain("Early Bird price (ends");
  });

  it("leads with the standard fee once the early bird has ended (#258)", () => {
    const html = card(render(selangor, false, null, false, null, "2026-06-01T00:00:00.000Z"));
    expect(html).toContain("RM40.00");
    expect(html).not.toContain("RM32.00");
    expect(html).not.toContain("price (ends");
  });

  it("never leads with a tier only some players qualify for, but mentions it", () => {
    const html = card(render(selangor, false, null, false, null, "2026-06-01T00:00:00.000Z"));
    expect(html.indexOf("RM40.00")).toBeLessThan(html.indexOf("RM24.00"));
    expect(html).toContain("From RM24.00 for eligible players");
  });

  it("says when eligible players enter free", () => {
    const html = card(
      render({
        entry_fees: {
          standard: { amount_cents: 3000 },
          additional: [{ type: "oku", amount_cents: 0, oku: true }],
        },
      }),
    );
    expect(html).toContain("RM30.00");
    expect(html).toContain("Free entry for eligible players");
  });

  it("shows Free for a free tournament", () => {
    const html = card(render({ entry_fees: { standard: { amount_cents: 0 } } }));
    expect(html).toContain("Free");
    expect(html).not.toContain("eligible players");
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

  it("renders special prizes alongside categories", () => {
    const html = render({
      prizes: {
        categories: [
          {
            name: "Open",
            entries: [{ place: "1st Place", amount_cents: 300000 }],
          },
        ],
        special: [
          { name: "Best Under-1500", amount_cents: 20000 },
          { name: "Best Female Player", amount_cents: 25000 },
        ],
      },
    });
    expect(html).toContain("Special");
    expect(html).toContain("Best Under-1500");
    expect(html).toContain("RM200");
    expect(html).toContain("Best Female Player");
    expect(html).toContain("RM250");
  });

  it("renders the prizes section when there are special prizes but no categories", () => {
    const html = render({
      prizes: {
        categories: [],
        special: [{ name: "Best Veteran", amount_cents: 15000 }],
      },
    });
    expect(html).toContain("Prizes");
    expect(html).toContain("Best Veteran");
    expect(html).toContain("RM150");
  });

  it("omits special prizes carrying no money", () => {
    const html = render({
      prizes: {
        categories: [],
        special: [
          { name: "Best Female Player", amount_cents: 25000 },
          { name: "Best Veteran", amount_cents: 0 },
          { name: "Best Junior" },
        ],
      },
    });
    expect(html).toContain("Best Female Player");
    expect(html).not.toContain("Best Veteran");
    expect(html).not.toContain("Best Junior");
    // formatRm(0) reads "Free" — no prize row should ever say that.
    expect(html).not.toContain("Free");
  });

  it("omits the Special heading when every special prize is zero-amount", () => {
    const html = render({
      prizes: {
        categories: [
          {
            name: "Open",
            entries: [{ place: "1st Place", amount_cents: 300000 }],
          },
        ],
        special: [{ name: "Best Veteran", amount_cents: 0 }],
      },
    });
    expect(html).toContain("Open");
    expect(html).not.toContain("Special");
  });

  it("hides the prizes section when categories and special prizes are both empty", () => {
    const html = render({ prizes: { categories: [], special: [] } });
    expect(html).not.toContain("1st Place");
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

  it("shows 'Open to All' badge when restrictions are null", () => {
    const html = render({ restrictions: null });
    expect(html).toContain("Open to All");
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
      restrictions: {
        min_rating: null,
        max_rating: null,
        min_age: null,
        max_age: 18,
      },
    });
    expect(html).toContain("18");
  });

  it("renders gender restriction and hides 'Open to All' badge", () => {
    const html = render({ restrictions: { gender: "female" } });
    expect(html).toContain("Female");
    expect(html).not.toContain("Open to All");
  });

  it("renders nationality restriction resolved to a country name", () => {
    const html = render({ restrictions: { nationality: "Malaysia" } });
    expect(html).toContain("Malaysia");
    expect(html).not.toContain("Open to All");
  });

  it("renders titles restriction", () => {
    const html = render({
      restrictions: { titles: ["GM", "IM"] },
    });
    expect(html).toContain("GM, IM");
    expect(html).not.toContain("Open to All");
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
      organization: { ...base.organization!, phone: null },
    });
    expect(html).not.toContain("+60123456789");
  });

  it("hides organizer section when organizer is null", () => {
    const html = render({ organization: null });
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
    const html = render(
      { max_participants: 100, current_participants: 100 },
      true,
    );
    expect(html).toContain("Full Capacity");
  });

  it("applies low-spots colour class when spots ratio is at or below 20%", () => {
    // 4 spots left out of 100 → 4% ≤ 20%, not full
    const html = render({ max_participants: 100, current_participants: 96 });
    expect(html).toContain("text-amber-400");
  });

  it("shows registration deadline", () => {
    const html = render();
    expect(html).toContain("28 Dec");
  });
});

// ── CTA button auth states ────────────────────────────────────

describe("CTA button auth states", () => {
  it("shows 'Register Now' when authenticated and spots available", () => {
    const html = render({}, true);
    expect(html).toContain("Register Now");
  });

  it("shows 'Sign In to Register' when not authenticated and spots available", () => {
    const html = render({}, false);
    expect(html).toContain("Sign In to Register");
  });

  it("disables CTA button when not authenticated", () => {
    const html = render({}, false);
    expect(html).toContain("disabled");
  });

  it("shows 'Full Capacity' and disables button for authenticated when no spots remain", () => {
    const htmlAuth = render(
      { max_participants: 100, current_participants: 100 },
      true,
    );
    expect(htmlAuth).toContain("Full Capacity");
    expect(htmlAuth).toContain("disabled");
  });

  it("shows 'Full Capacity' over 'Sign In to Register' for unauthenticated users when no spots remain", () => {
    const htmlNoAuth = render(
      { max_participants: 100, current_participants: 100 },
      false,
    );
    expect(htmlNoAuth).toContain("Full Capacity");
    expect(htmlNoAuth).not.toContain("Sign In to Register");
    expect(htmlNoAuth).toContain("disabled");
  });

  it("shows 'Registration Closed' when deadline has passed", () => {
    const pastDeadline = new Date(Date.now() - 1000).toISOString();
    const html = render({ registration_deadline: pastDeadline }, true);
    expect(html).toContain("Registration Closed");
    expect(html).toContain("disabled");
  });

  it("shows 'Registration Closed' for unauthenticated users when deadline has passed", () => {
    const pastDeadline = new Date(Date.now() - 1000).toISOString();
    const html = render({ registration_deadline: pastDeadline }, false);
    expect(html).toContain("Registration Closed");
    expect(html).not.toContain("Sign In to Register");
    expect(html).toContain("disabled");
  });

  it("shows 'Registered' when authenticated user is confirmed", () => {
    const html = render({}, true, "confirmed");
    expect(html).toContain("Registered");
    expect(html).toContain("disabled");
  });

  it("shows 'Complete Payment' when the user has a pending_payment registration", () => {
    const html = render({}, true, "pending_payment");
    expect(html).toContain("Complete Payment");
    expect(html).not.toContain("Registered");
  });

  it("shows 'Register Now' when the user's previous payment failed", () => {
    const html = render({}, true, "failed_payment");
    expect(html).toContain("Register Now");
  });

  it("shows 'Registration Closed' over 'Full Capacity' when deadline passed and tournament is full", () => {
    const pastDeadline = new Date(Date.now() - 1000).toISOString();
    const html = render(
      {
        max_participants: 100,
        current_participants: 100,
        registration_deadline: pastDeadline,
      },
      true,
    );
    expect(html).toContain("Registration Closed");
    expect(html).not.toContain("Full Capacity");
  });

  it("shows 'Registered' over 'Registration Closed' when user is confirmed and deadline passed", () => {
    const pastDeadline = new Date(Date.now() - 1000).toISOString();
    const html = render(
      { registration_deadline: pastDeadline },
      true,
      "confirmed",
    );
    expect(html).toContain("Registered");
    expect(html).not.toContain("Registration Closed");
  });

  it("shows 'Registered' over 'Full Capacity' when user is confirmed and tournament is full", () => {
    const html = render(
      { max_participants: 100, current_participants: 100 },
      true,
      "confirmed",
    );
    expect(html).toContain("Registered");
    expect(html).not.toContain("Full Capacity");
  });
});

describe("registering a dependent (#774)", () => {
  function renderGuardian(
    overrides: Partial<TournamentDetailType> = {},
    dependentToRegisterId: string | null = "dep-1",
    awaitingPrizeFunding = false,
  ): string {
    return renderToStaticMarkup(
      <TournamentDetail
        tournament={{ ...base, ...overrides }}
        isAuthenticated
        registrationStatus="confirmed"
        dependentToRegisterId={dependentToRegisterId}
        awaitingPrizeFunding={awaitingPrizeFunding}
        canViewStartingRank={false}
        startingRank={null}
        now={NOW}
      />,
    );
  }

  it("lets a registered guardian register a dependent who isn't yet", () => {
    const html = renderGuardian();
    expect(html).toContain("You&#x27;re registered for this tournament.");
    expect(html).toContain("Register a Dependent");
    expect(html).toContain(
      `href="/tournaments/${base.slug}/register?participant=dep-1"`,
    );
    expect(html).not.toContain(">Registered<");
  });

  it("shows 'Registered' when every dependent is registered too", () => {
    const html = renderGuardian({}, null);
    expect(html).toContain(">Registered<");
    expect(html).not.toContain("Register a Dependent");
  });

  it("shows 'Registered' once registration has closed", () => {
    const pastDeadline = new Date(Date.now() - 1000).toISOString();
    const html = renderGuardian({ registration_deadline: pastDeadline });
    expect(html).toContain(">Registered<");
    expect(html).not.toContain("Register a Dependent");
  });

  it("shows 'Registered' when the tournament is full", () => {
    const html = renderGuardian({
      max_participants: 100,
      current_participants: 100,
    });
    expect(html).toContain(">Registered<");
    expect(html).not.toContain("Register a Dependent");
  });

  it("shows 'Registered' while the prize pool is unfunded", () => {
    const html = renderGuardian({}, "dep-1", true);
    expect(html).toContain(">Registered<");
    expect(html).not.toContain("Register a Dependent");
  });
});

// ── Starting rank tab visibility ──────────────────────────────
// StartingRankTab display logic is tested in StartingRankTab.test.tsx.
// Here we only verify it renders without error under various prop combinations.

describe("starting rank tab integration", () => {
  it("renders without error when startingRank is null", () => {
    const html = render({}, false, null, false, null);
    expect(html).toContain("Starting Rank");
  });

  it("renders without error when startingRank is an empty array", () => {
    const html = render({}, true, "confirmed", true, []);
    expect(html).toContain("Starting Rank");
  });

  it("renders without error when startingRank has players", () => {
    const html = render({}, true, "confirmed", true, samplePlayers);
    expect(html).toContain("Starting Rank");
  });
});

// ── Platform-distributed prize pool (#523) ───────────────────

describe("platform prize pool", () => {
  const platformPrizes = { ...base.prizes!, distribution: "platform" as const };

  function renderPool(awaitingPrizeFunding: boolean, registrationStatus: string | null = null) {
    return renderToStaticMarkup(
      <TournamentDetail
        tournament={{ ...base, prizes: platformPrizes }}
        isAuthenticated
        registrationStatus={registrationStatus}
        awaitingPrizeFunding={awaitingPrizeFunding}
        canViewStartingRank={false}
        startingRank={null}
        now={NOW}
      />,
    );
  }

  it("keeps registration shut until the pool is funded", () => {
    const html = renderPool(true);
    expect(html).toContain("Opens Once Prizes Are Funded");
    expect(html).not.toContain("Register Now");
    expect(html).toContain("Registration opens once the full pool has been paid in");
  });

  it("opens registration once the pool is funded", () => {
    const html = renderPool(false);
    expect(html).toContain("Register Now");
    expect(html).toContain("from a fully funded pool");
  });

  it("still shows a confirmed player as registered", () => {
    expect(renderPool(true, "confirmed")).toContain("Registered");
  });

  it("says nothing about a pool when the organizer pays the winners", () => {
    const html = render({}, true);
    expect(html).not.toContain("funded pool");
  });
});
