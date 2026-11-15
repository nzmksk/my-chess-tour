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
