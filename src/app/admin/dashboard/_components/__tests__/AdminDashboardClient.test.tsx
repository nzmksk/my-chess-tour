// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AdminDashboardClient from "../AdminDashboardClient";

function tournament(id: string, name: string, status: string) {
  return {
    id,
    name,
    organization_name: "KL Chess Club",
    start_date: "2099-09-01",
    status,
    current_participants: 0,
    max_participants: 64,
  };
}

const DATA = {
  stats: {
    total_users: 0,
    organizations: { total: 0, pending: 0, approved: 0, rejected: 0 },
    tournaments: { total: 3, published: 1, draft: 1, cancelled: 1 },
    total_registrations: 0,
    platform_revenue_cents: 0,
  },
  stuck_refunds: 0,
  pending_organizations: [],
  recent_tournaments: [
    tournament("t-published", "Published Open", "published"),
    tournament("t-draft", "Draft Open", "draft"),
    tournament("t-cancelled", "Cancelled Open", "cancelled"),
  ],
};

afterEach(cleanup);

describe("AdminDashboardClient recent tournaments", () => {
  it.each([
    ["Published Open", "t-published"],
    ["Draft Open", "t-draft"],
    ["Cancelled Open", "t-cancelled"],
  ])("links %s to the admin tournament view", (name, id) => {
    render(<AdminDashboardClient data={DATA} />);
    const link = screen.getByText(name).closest("a");
    expect(link?.getAttribute("href")).toBe(`/admin/tournaments/${id}`);
  });
});

describe("AdminDashboardClient stuck refunds", () => {
  it("shows no alert when nothing is stuck", () => {
    render(<AdminDashboardClient data={DATA} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [1, "1 refund is stuck. A player is still owed money."],
    [3, "3 refunds are stuck. Players are still owed money."],
  ])("alerts with the count (%i) and links to the stuck refunds", (count, text) => {
    render(<AdminDashboardClient data={{ ...DATA, stuck_refunds: count }} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(text);
    expect(alert.getAttribute("href")).toBe("/admin/refunds");
  });

  it("says it couldn't check rather than showing nothing", () => {
    render(<AdminDashboardClient data={{ ...DATA, stuck_refunds: null }} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't check for stuck refunds.",
    );
  });
});
