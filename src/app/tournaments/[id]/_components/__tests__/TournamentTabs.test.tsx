// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TournamentTabs from "../TournamentTabs";

afterEach(cleanup);

const detailsContent = <div data-testid="details">Tournament Details Content</div>;
const startingRankContent = <div data-testid="starting-rank">Starting Rank Content</div>;

describe("TournamentTabs", () => {
  // ── Initial rendering ──────────────────────────────────────

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

  it("shows tournament details content by default", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    expect(screen.getByTestId("details")).toBeDefined();
    expect(screen.queryByTestId("starting-rank")).toBeNull();
  });

  // ── Tab switching ──────────────────────────────────────────

  it("shows starting rank content when Starting Rank tab is clicked", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    fireEvent.click(screen.getByText("Starting Rank"));
    expect(screen.getByTestId("starting-rank")).toBeDefined();
    expect(screen.queryByTestId("details")).toBeNull();
  });

  it("switches back to tournament details when Tournament Details tab is clicked", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    fireEvent.click(screen.getByText("Starting Rank"));
    fireEvent.click(screen.getByText("Tournament Details"));
    expect(screen.getByTestId("details")).toBeDefined();
    expect(screen.queryByTestId("starting-rank")).toBeNull();
  });

  // ── Active tab styling ─────────────────────────────────────

  it("applies active styles to Tournament Details tab by default", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    const detailsBtn = screen.getByText("Tournament Details").closest("button")!;
    expect(detailsBtn.className).toContain("border-gold-bright");
    expect(detailsBtn.className).toContain("text-text-primary");
  });

  it("applies inactive styles to Starting Rank tab by default", () => {
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

  it("applies active styles to Starting Rank tab after clicking it", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    fireEvent.click(screen.getByText("Starting Rank"));
    const rankBtn = screen.getByText("Starting Rank").closest("button")!;
    expect(rankBtn.className).toContain("border-gold-bright");
    expect(rankBtn.className).toContain("text-text-primary");
  });

  it("applies inactive styles to Tournament Details tab when Starting Rank is active", () => {
    render(
      <TournamentTabs
        tournamentDetailsContent={detailsContent}
        startingRankContent={startingRankContent}
      />,
    );
    fireEvent.click(screen.getByText("Starting Rank"));
    const detailsBtn = screen.getByText("Tournament Details").closest("button")!;
    expect(detailsBtn.className).toContain("border-transparent");
  });
});
