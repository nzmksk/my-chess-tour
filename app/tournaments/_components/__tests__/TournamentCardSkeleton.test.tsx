/* eslint-disable @next/next/no-img-element */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TournamentCardSkeleton from "../TournamentCardSkeleton";
import TournamentCard from "../TournamentCard";
import type { Tournament } from "../../types";

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

const mockTournament: Tournament = {
  id: "1",
  name: "Test Tournament",
  venue_name: "Test Venue",
  state: "Selangor",
  start_date: "2026-06-01",
  end_date: "2026-06-02",
  registration_deadline: "2026-05-31",
  format: { type: "rapid", system: "swiss", rounds: 7 },
  time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 0 },
  is_fide_rated: true,
  is_mcf_rated: false,
  entry_fees: { standard: { amount_cents: 5000 } },
  max_participants: 100,
  current_participants: 50,
  poster_url: null,
  status: "published",
  organizer: null,
};

function getClasses(html: string, tag: string, index = 0): string[] {
  const regex = new RegExp(`<${tag}[^>]*class="([^"]*)"`, "g");
  const matches = [...html.matchAll(regex)];
  return matches[index]?.[1]?.split(" ") ?? [];
}

describe("TournamentCardSkeleton mirrors TournamentCard layout", () => {
  const cardHtml = renderToStaticMarkup(
    <TournamentCard tournament={mockTournament} />,
  );
  const skeletonHtml = renderToStaticMarkup(<TournamentCardSkeleton />);

  it("article uses tournament-card class", () => {
    expect(getClasses(cardHtml, "article")).toContain("tournament-card");
    expect(getClasses(skeletonHtml, "article")).toContain("tournament-card");
  });

  it("article has matching responsive grid columns", () => {
    const cardClasses = getClasses(cardHtml, "article");
    const skeletonClasses = getClasses(skeletonHtml, "article");

    expect(cardClasses).toContain("grid-cols-1");
    expect(cardClasses).toContain("sm:grid-cols-[10rem_1fr]");
    expect(skeletonClasses).toContain("grid-cols-1");
    expect(skeletonClasses).toContain("sm:grid-cols-[10rem_1fr]");
  });

  it("poster column is hidden below sm on both", () => {
    // Real card uses hidden sm:flex, skeleton uses hidden sm:block
    const cardPosterClasses = getClasses(cardHtml, "div", 0);
    const skeletonPosterClasses = getClasses(skeletonHtml, "div", 0);

    expect(cardPosterClasses).toContain("hidden");
    expect(cardPosterClasses.some((c) => c.startsWith("sm:"))).toBe(true);
    expect(skeletonPosterClasses).toContain("hidden");
    expect(skeletonPosterClasses.some((c) => c.startsWith("sm:"))).toBe(true);
  });

  it("body column has matching layout", () => {
    const bodyClasses = ["p-4", "flex", "flex-col", "justify-center"];

    for (const cls of bodyClasses) {
      expect(cardHtml).toContain(cls);
      expect(skeletonHtml).toContain(cls);
    }
  });

  it("footer has matching border separator", () => {
    const footerClasses = [
      "flex",
      "justify-between",
      "items-center",
      "pt-3",
      "border-t",
      "border-(--color-border)",
    ];

    for (const cls of footerClasses) {
      expect(cardHtml).toContain(cls);
      expect(skeletonHtml).toContain(cls);
    }
  });
});
