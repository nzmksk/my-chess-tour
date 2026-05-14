"use client";

import { useState } from "react";
import type { ReactNode } from "react";

type Tab = "details" | "starting-rank";

interface Props {
  tournamentDetailsContent: ReactNode;
  startingRankContent: ReactNode;
}

export default function TournamentTabs({
  tournamentDetailsContent,
  startingRankContent,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("details");

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "details", label: "Tournament Details" },
    { key: "starting-rank", label: "Starting Rank" },
  ];

  return (
    <div>
      <div className="flex border-b border-border mb-6">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`font-lato text-sm font-medium px-4 py-2.5 border-b-2 transition-colors duration-150 cursor-pointer bg-transparent ${
              activeTab === key
                ? "text-text-primary border-gold-bright"
                : "text-text-muted border-transparent hover:text-text-secondary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "details" ? tournamentDetailsContent : startingRankContent}
    </div>
  );
}
