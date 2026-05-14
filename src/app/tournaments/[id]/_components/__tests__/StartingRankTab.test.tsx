import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StartingRankTab from "../StartingRankTab";
import type { StartingRankPlayer } from "../../types";

// ── Fixtures ─────────────────────────────────────────────────

const samplePlayers: StartingRankPlayer[] = [
  {
    rank: 1,
    user_id: "u1",
    name: "Alice Wong",
    title: "WFM",
    fide_id: 123456,
    fide_rating: 2100,
    national_rating: null,
  },
  {
    rank: 2,
    user_id: "u2",
    name: "Bob Lee",
    title: null,
    fide_id: null,
    fide_rating: null,
    national_rating: 1500,
  },
  {
    rank: 3,
    user_id: "u3",
    name: "Carol Chan",
    title: null,
    fide_id: null,
    fide_rating: null,
    national_rating: null,
  },
];

function render(props: {
  startingRank: StartingRankPlayer[] | null;
  canViewStartingRank: boolean;
  tournamentStarted: boolean;
  isAuthenticated: boolean;
}): string {
  return renderToStaticMarkup(<StartingRankTab {...props} />);
}

// ── Access control ────────────────────────────────────────────

describe("access control", () => {
  it("shows sign-in message for unauthenticated users who cannot view", () => {
    const html = render({
      startingRank: null,
      canViewStartingRank: false,
      tournamentStarted: false,
      isAuthenticated: false,
    });
    expect(html).toContain("Sign in and register");
  });

  it("shows register message for authenticated users who cannot view", () => {
    const html = render({
      startingRank: null,
      canViewStartingRank: false,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("Register for this tournament");
  });

  it("does not show the sign-in message when canViewStartingRank is true", () => {
    const html = render({
      startingRank: [],
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).not.toContain("Sign in and register");
  });

  it("does not show access message when tournament has started regardless of auth", () => {
    const html = render({
      startingRank: samplePlayers,
      canViewStartingRank: true,
      tournamentStarted: true,
      isAuthenticated: false,
    });
    expect(html).not.toContain("Sign in and register");
    expect(html).not.toContain("Register for this tournament");
  });
});

// ── Empty state ───────────────────────────────────────────────

describe("empty state", () => {
  it("shows empty state when authorized but no players registered", () => {
    const html = render({
      startingRank: [],
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("No confirmed registrations yet");
  });

  it("shows empty state when startingRank is null but canViewStartingRank is true", () => {
    const html = render({
      startingRank: null,
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("No confirmed registrations yet");
  });
});

// ── Player table ──────────────────────────────────────────────

describe("player table", () => {
  it("renders player names", () => {
    const html = render({
      startingRank: samplePlayers,
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("Alice Wong");
    expect(html).toContain("Bob Lee");
    expect(html).toContain("Carol Chan");
  });

  it("renders rank numbers", () => {
    const html = render({
      startingRank: samplePlayers,
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
    expect(html).toContain(">3<");
  });

  it("renders FIDE title badge when present", () => {
    const html = render({
      startingRank: samplePlayers,
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("WFM");
  });

  it("renders FIDE rating with FIDE label", () => {
    const html = render({
      startingRank: samplePlayers,
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("2100");
    expect(html).toContain("FIDE");
  });

  it("renders national rating with Nat. label for player without FIDE rating", () => {
    const html = render({
      startingRank: samplePlayers,
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("1500");
    expect(html).toContain("Nat.");
  });

  it("renders dash for player with no ratings", () => {
    const html = render({
      startingRank: samplePlayers,
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("—");
  });

  it("renders FIDE ID when present", () => {
    const html = render({
      startingRank: samplePlayers,
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("123456");
  });

  it("does not render FIDE ID when absent", () => {
    const html = render({
      startingRank: [samplePlayers[1]], // Bob Lee has no FIDE ID
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).not.toContain("123456");
  });

  it("shows plural 'players' for multiple players", () => {
    const html = render({
      startingRank: samplePlayers,
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("3 players");
  });

  it("shows singular 'player' for exactly one player", () => {
    const html = render({
      startingRank: [samplePlayers[0]],
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("1 player");
    expect(html).not.toContain("1 players");
  });

  it("renders table header columns", () => {
    const html = render({
      startingRank: samplePlayers,
      canViewStartingRank: true,
      tournamentStarted: false,
      isAuthenticated: true,
    });
    expect(html).toContain("Player");
    expect(html).toContain("Rating");
  });
});
