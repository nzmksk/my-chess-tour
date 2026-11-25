"use client";

import { useRef, useState } from "react";
import type { Tournament } from "../types";
import { paginate } from "../utils";
import TournamentCard from "./TournamentCard";

export const TOURNAMENTS_PAGE_SIZE = 12;

interface Props {
  label: string;
  tournaments: Tournament[];
  now: string;
  dimmed?: boolean;
}

export default function TournamentSection({
  label,
  tournaments,
  now,
  dimmed,
}: Props) {
  const [page, setPage] = useState(1);
  const sectionRef = useRef<HTMLElement>(null);
  const {
    items,
    page: shownPage,
    pageCount,
  } = paginate(tournaments, page, TOURNAMENTS_PAGE_SIZE);

  function goTo(next: number) {
    setPage(next);
    sectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <section ref={sectionRef} aria-label={label} className="scroll-mt-20">
      <div className="mb-4 flex items-center gap-4">
        <span className="font-cinzel text-text-muted shrink-0 text-xs tracking-widest uppercase">
          {label}
        </span>
        <div className="bg-border h-px flex-1" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
        {items.map((t) => (
          <TournamentCard key={t.id} tournament={t} now={now} dimmed={dimmed} />
        ))}
      </div>
      {pageCount > 1 && (
        <nav
          aria-label={`${label} pages`}
          className="mt-6 flex items-center justify-between gap-4"
        >
          <button
            type="button"
            className="btn-secondary px-4"
            onClick={() => goTo(shownPage - 1)}
            disabled={shownPage <= 1}
          >
            Previous
          </button>
          <p className="font-lato text-text-muted text-sm" aria-live="polite">
            Page {shownPage} of {pageCount}
          </p>
          <button
            type="button"
            className="btn-secondary px-4"
            onClick={() => goTo(shownPage + 1)}
            disabled={shownPage >= pageCount}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
