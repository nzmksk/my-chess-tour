// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TournamentTabs from "../TournamentTabs";

// ── next/navigation mock ───────────────────────────────────────

let mockTabParam: string | null = null;
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/tournaments/t1",
  useSearchParams: () => ({
    get: (key: string) => (key === "tab" ? mockTabParam : null),
    toString: () => (mockTabParam ? `tab=${mockTabParam}` : ""),
  }),
}));

afterEach(() => {
  cleanup();
  mockTabParam = null;
  mockReplace.mockClear();
});

const detailsContent = (
  <div data-testid="details">Tournament Details Content</div>
);
const startingRankContent = (
  <div data-testid="starting-rank">Starting Rank Content</div>
);

// ── Initial rendering ──────────────────────────────────────────

describe("TournamentTabs — initial rendering", () => {
  it("renders the Tournament Details tab button", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    expect(screen.getByText("Tournament Details")).toBeDefined();
  });

  it("renders the Starting Rank tab button", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    expect(screen.getByText("Starting Rank")).toBeDefined();
  });

  it("shows details content by default when no tab param is set", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    expect(screen.getByTestId("details")).toBeDefined();
    expect(screen.queryByTestId("starting-rank")).toBeNull();
  });

  it("shows starting rank content when tab=starting-rank is in the URL", () => {
    mockTabParam = "starting-rank";
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    expect(screen.getByTestId("starting-rank")).toBeDefined();
    expect(screen.queryByTestId("details")).toBeNull();
  });

  it("falls back to details for an unrecognised tab param value", () => {
    mockTabParam = "unknown-tab";
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    expect(screen.getByTestId("details")).toBeDefined();
    expect(screen.queryByTestId("starting-rank")).toBeNull();
  });
});

// ── Tab interaction (router.replace calls) ─────────────────────

describe("TournamentTabs — tab interaction", () => {
  it("calls router.replace with ?tab=starting-rank when Starting Rank is clicked", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    fireEvent.click(screen.getByText("Starting Rank"));
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("tab=starting-rank"),
      expect.objectContaining({ scroll: false }),
    );
  });

  it("calls router.replace without tab param when Tournament Details is clicked", () => {
    mockTabParam = "starting-rank";
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    fireEvent.click(screen.getByText("Tournament Details"));
    expect(mockReplace).toHaveBeenCalledWith(
      expect.not.stringContaining("tab="),
      expect.objectContaining({ scroll: false }),
    );
  });

  it("calls router.replace when Tournament Details is clicked even from details tab", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    fireEvent.click(screen.getByText("Tournament Details"));
    expect(mockReplace).toHaveBeenCalledOnce();
  });
});

// ── Active tab styling ─────────────────────────────────────────

describe("TournamentTabs — active tab styling", () => {
  it("applies active styles to Tournament Details tab when no param is set", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    const detailsBtn = screen
      .getByText("Tournament Details")
      .closest("button")!;
    expect(detailsBtn.className).toContain("border-gold-bright");
    expect(detailsBtn.className).toContain("text-text-primary");
  });

  it("applies inactive styles to Starting Rank tab when no param is set", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    const rankBtn = screen.getByText("Starting Rank").closest("button")!;
    expect(rankBtn.className).toContain("border-transparent");
    expect(rankBtn.className).toContain("text-text-muted");
  });

  it("applies active styles to Starting Rank tab when tab=starting-rank", () => {
    mockTabParam = "starting-rank";
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    const rankBtn = screen.getByText("Starting Rank").closest("button")!;
    expect(rankBtn.className).toContain("border-gold-bright");
    expect(rankBtn.className).toContain("text-text-primary");
  });

  it("applies inactive styles to Tournament Details tab when Starting Rank is active", () => {
    mockTabParam = "starting-rank";
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    const detailsBtn = screen
      .getByText("Tournament Details")
      .closest("button")!;
    expect(detailsBtn.className).toContain("border-transparent");
  });
});
