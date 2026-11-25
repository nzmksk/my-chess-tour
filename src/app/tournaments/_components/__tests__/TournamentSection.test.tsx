// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

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

import TournamentSection, { TOURNAMENTS_PAGE_SIZE } from "../TournamentSection";
import TournamentsClient from "../TournamentsClient";
import type { Tournament } from "../../types";

const NOW = "2027-01-01T00:00:00.000Z";

function tournament(
  i: number,
  overrides: Partial<Tournament> = {},
): Tournament {
  return {
    id: String(i),
    slug: `tournament-${i}`,
    name: `Tournament ${i}`,
    venue: { name: "Test Venue", state: "Selangor" },
    timezone: "Asia/Kuala_Lumpur",
    start_date: "2027-06-01",
    end_date: "2027-06-02",
    registration_deadline: "2027-05-31",
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

function many(count: number, overrides: Partial<Tournament> = {}) {
  return Array.from({ length: count }, (_, i) => tournament(i + 1, overrides));
}

function shownNames(): string[] {
  return screen
    .getAllByRole("heading")
    .map((h) => h.textContent ?? "")
    .filter((text) => text.startsWith("Tournament "));
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("TournamentSection", () => {
  it("shows every card and no page controls when they fit on one page", () => {
    render(
      <TournamentSection
        label="Upcoming"
        tournaments={many(TOURNAMENTS_PAGE_SIZE)}
        now={NOW}
      />,
    );

    expect(shownNames()).toHaveLength(TOURNAMENTS_PAGE_SIZE);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows one page at a time and moves between pages", () => {
    render(
      <TournamentSection
        label="Upcoming"
        tournaments={many(TOURNAMENTS_PAGE_SIZE * 2 + 1)}
        now={NOW}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Upcoming pages" });
    const previous = within(nav).getByRole("button", { name: "Previous" });
    const next = within(nav).getByRole("button", { name: "Next" });

    expect(shownNames()).toHaveLength(TOURNAMENTS_PAGE_SIZE);
    expect(shownNames()[0]).toBe("Tournament 1");
    expect(within(nav).getByText("Page 1 of 3")).toBeTruthy();
    expect((previous as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(next);
    expect(shownNames()[0]).toBe(`Tournament ${TOURNAMENTS_PAGE_SIZE + 1}`);
    expect(within(nav).getByText("Page 2 of 3")).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    fireEvent.click(next);
    expect(shownNames()).toEqual([
      `Tournament ${TOURNAMENTS_PAGE_SIZE * 2 + 1}`,
    ]);
    expect((next as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(previous);
    expect(within(nav).getByText("Page 2 of 3")).toBeTruthy();
  });
});

describe("TournamentsClient pagination", () => {
  it("goes back to the first page when a filter changes", () => {
    render(
      <TournamentsClient
        tournaments={[
          ...many(TOURNAMENTS_PAGE_SIZE * 2),
          tournament(99, { name: "Tournament Blitz Open" }),
        ]}
        now={NOW}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Upcoming pages" });
    fireEvent.click(within(nav).getByRole("button", { name: "Next" }));
    expect(within(nav).getByText("Page 2 of 3")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search tournaments…"), {
      target: { value: "tournament" },
    });

    expect(
      within(
        screen.getByRole("navigation", { name: "Upcoming pages" }),
      ).getByText("Page 1 of 3"),
    ).toBeTruthy();
    expect(shownNames()[0]).toBe("Tournament 1");
  });
});
