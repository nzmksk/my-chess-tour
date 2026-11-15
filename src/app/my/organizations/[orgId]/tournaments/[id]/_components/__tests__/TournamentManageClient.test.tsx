// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TournamentManageClient from "../TournamentManageClient";
import { getTodayInTimeZone } from "@/lib/tournaments/datetime";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const TOUR_ID = "22222222-2222-4222-8222-222222222222";

const TOURNAMENT = {
  id: TOUR_ID,
  name: "KL Open Rapid",
  status: "draft" as const,
  start_date: "2099-09-01",
  end_date: "2099-09-02",
  timezone: "Asia/Kuala_Lumpur",
  registration_deadline: null,
  registration_closed_at: null,
  venue: { name: "KL Convention Centre", state: "W.P. Kuala Lumpur" },
  format: { type: "rapid" },
  max_participants: 64,
  organization: { id: ORG_ID, name: "KL Chess Club" },
};

const PARTICIPANTS = [
  {
    index: 1,
    id: "reg-1",
    user_id: "user-1",
    name: "Ahmad Ali",
    fide_id: 123456,
    rating: 1800,
    fee_tier: "standard",
    status: "confirmed",
    registered_at: "2099-08-01T02:00:00Z",
  },
];

function renderClient(
  viewer?: "organizer" | "admin",
  tournament: React.ComponentProps<
    typeof TournamentManageClient
  >["tournament"] = TOURNAMENT,
) {
  return render(
    <TournamentManageClient
      orgId={ORG_ID}
      tournament={tournament}
      stats={{ total: 1, confirmed: 1, pending: 0 }}
      participants={PARTICIPANTS}
      cancellationPending={false}
      viewer={viewer}
    />,
  );
}

afterEach(cleanup);

describe("TournamentManageClient", () => {
  it("offers the organizer edit and publish actions on a draft", () => {
    renderClient();

    expect(screen.getByText("← Back to Dashboard").getAttribute("href")).toBe(
      `/my/organizations/${ORG_ID}`,
    );
    expect(screen.getByText("Edit Tournament")).toBeTruthy();
    expect(screen.getByRole("button", { name: /publish/i })).toBeTruthy();
    expect(screen.queryByText(/Organized by/)).toBeNull();
  });

  it("shows the admin the roster read-only, without organizer actions", () => {
    renderClient("admin");

    expect(
      screen.getByText("← Back to Admin Dashboard").getAttribute("href"),
    ).toBe("/admin/dashboard");
    expect(screen.getByText("Organized by KL Chess Club")).toBeTruthy();
    expect(screen.getByText("Ahmad Ali")).toBeTruthy();
    expect(screen.queryByText("Edit Tournament")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the organizer the roster as CSV and Excel downloads", () => {
    renderClient();

    const base = `/api/v1/organizations/${ORG_ID}/tournaments/${TOUR_ID}/participants/export`;
    const csv = screen.getByRole("link", { name: "Export CSV" });
    const xlsx = screen.getByRole("link", { name: "Export Excel" });
    expect(csv.getAttribute("href")).toBe(`${base}?format=csv`);
    expect(xlsx.getAttribute("href")).toBe(`${base}?format=xlsx`);
    expect(csv.hasAttribute("download")).toBe(true);
  });

  // The export endpoint is for the organization's owners and admins.
  it("doesn't offer the admin an export", () => {
    renderClient("admin");
    expect(screen.queryByRole("link", { name: /export/i })).toBeNull();
  });

  it("offers no export before anyone has registered", () => {
    render(
      <TournamentManageClient
        orgId={ORG_ID}
        tournament={TOURNAMENT}
        stats={{ total: 0, confirmed: 0, pending: 0 }}
        participants={[]}
        cancellationPending={false}
      />,
    );
    expect(screen.queryByRole("link", { name: /export/i })).toBeNull();
  });

  // The edit policy leaves the description editable while a tournament runs.
  it("offers Edit while a published tournament is under way", () => {
    const today = getTodayInTimeZone(TOURNAMENT.timezone);
    renderClient("organizer", {
      ...TOURNAMENT,
      status: "published",
      start_date: today,
      end_date: today,
    });
    expect(screen.getByText("Edit Tournament")).toBeTruthy();
  });

  it("hides Edit once the tournament has ended", () => {
    renderClient("organizer", {
      ...TOURNAMENT,
      status: "published",
      start_date: "2020-01-01",
      end_date: "2020-01-02",
    });
    expect(screen.queryByText("Edit Tournament")).toBeNull();
  });

  it("hides Edit on a cancelled tournament", () => {
    renderClient("organizer", { ...TOURNAMENT, status: "cancelled" });
    expect(screen.queryByText("Edit Tournament")).toBeNull();
  });
});
