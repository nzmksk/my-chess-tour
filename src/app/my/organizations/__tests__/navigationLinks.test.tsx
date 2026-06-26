import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

import { discoverRouteTemplates, isValidRoute } from "@/test/appRoutes";

// Render <Link> as a plain <a> so hrefs land in the static markup.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import DashboardClient from "../[orgId]/_components/DashboardClient";
import MembersClient from "../[orgId]/members/_components/MembersClient";
import TournamentManageClient from "../[orgId]/tournaments/[id]/_components/TournamentManageClient";
import ApplicationsClient from "../applications/_components/ApplicationsClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull every internal (path-only) href out of rendered markup. */
function internalHrefs(markup: string): string[] {
  const hrefs = [...markup.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  return hrefs.filter((h) => h.startsWith("/"));
}

const ORG_ID = "org-1111-2222";
const TOURNAMENT_ID = "tour-3333-4444";

const dashboardData = {
  organization: { id: ORG_ID, name: "Test Organization" },
  stats: {
    active_tournaments: 1,
    total_registrations: 0,
    total_revenue_cents: 0,
    pending_payout_cents: 0,
  },
  recent_tournaments: [
    {
      id: "t-draft",
      name: "Draft Open",
      start_date: "2026-08-01",
      current_participants: 0,
      max_participants: 16,
      status: "draft" as const,
    },
    {
      id: "t-published",
      name: "Published Open",
      start_date: "2026-09-01",
      current_participants: 4,
      max_participants: 16,
      status: "published" as const,
    },
  ],
};

const tournament = {
  id: TOURNAMENT_ID,
  name: "City Open",
  status: "draft" as const,
  start_date: "2026-08-01",
  end_date: "2026-08-02",
  venue: { name: "City Hall", state: "Selangor", address: "1 Main St" },
  format: null,
  max_participants: 16,
};

const applications = [
  {
    id: "app-approved",
    name: "Approved Org",
    approval_status: "approved" as const,
    rejection_reason: null,
    created_at: "2026-01-01T00:00:00Z",
    reviewed_at: "2026-01-02T00:00:00Z",
  },
  {
    id: "app-pending",
    name: "Pending Org",
    approval_status: "pending" as const,
    rejection_reason: null,
    created_at: "2026-01-03T00:00:00Z",
    reviewed_at: null,
  },
];

const members = [
  {
    user_id: "u-1",
    email: "owner@example.com",
    first_name: "Owner",
    last_name: "One",
    avatar_url: null,
    role: "owner",
    joined_at: "2026-01-01T00:00:00Z",
  },
];

// Each case renders a component and yields the internal hrefs it produces.
const CASES: { name: string; markup: () => string }[] = [
  {
    name: "DashboardClient",
    markup: () =>
      renderToStaticMarkup(<DashboardClient data={dashboardData} />),
  },
  {
    name: "TournamentManageClient",
    markup: () =>
      renderToStaticMarkup(
        <TournamentManageClient
          orgId={ORG_ID}
          tournament={tournament}
          stats={{ total: 0, confirmed: 0, pending: 0 }}
          participants={[]}
        />,
      ),
  },
  {
    name: "ApplicationsClient",
    markup: () =>
      renderToStaticMarkup(<ApplicationsClient applications={applications} />),
  },
  {
    name: "MembersClient",
    markup: () =>
      renderToStaticMarkup(
        <MembersClient
          orgId={ORG_ID}
          orgName="Test Organization"
          members={members}
          currentUserId="u-1"
        />,
      ),
  },
];

// Navigation that happens via router.push()/redirect() rather than an <a>, so
// it cannot be scraped from markup. Kept as concrete paths and validated the
// same way — folder moves still break these.
const PROGRAMMATIC_NAV = [
  // WizardShell default redirect after save (tournaments/create + edit flows)
  `/my/organizations/${ORG_ID}`,
  // edit/page.tsx passes this redirectPath to WizardShell
  `/my/organizations/${ORG_ID}/tournaments/${TOURNAMENT_ID}`,
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("app route discovery", () => {
  it("finds the known organizer page routes", () => {
    const routes = discoverRouteTemplates();
    // Sanity-check the helper actually read the tree (guards against an empty
    // route set silently passing every link assertion).
    expect(routes).toContain("/my/organizations/[orgId]");
    expect(routes).toContain("/my/organizations/[orgId]/members");
    expect(routes).toContain("/my/organizations/[orgId]/tournaments/[id]");
    expect(routes).toContain("/my/organizations/[orgId]/tournaments/[id]/edit");
    expect(routes).toContain("/my/organizations/[orgId]/tournaments/create");
    expect(routes).toContain("/my/organizations/applications");
  });

  it("rejects a path that does not exist", () => {
    expect(isValidRoute("/organizations/org-1/dashboard")).toBe(false);
    expect(isValidRoute("/my/organizations/org-1/nope")).toBe(false);
  });

  it("accepts a real dynamic route", () => {
    expect(isValidRoute("/my/organizations/org-1")).toBe(true);
    expect(isValidRoute("/my/organizations/org-1/members")).toBe(true);
  });
});

describe("navigation links resolve to real page routes", () => {
  for (const { name, markup } of CASES) {
    it(`${name} links all point at existing routes`, () => {
      const hrefs = internalHrefs(markup());
      expect(hrefs.length).toBeGreaterThan(0);

      const broken = hrefs.filter((href) => !isValidRoute(href));
      expect(
        broken,
        `${name} has links with no matching page route: ${broken.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("programmatic (router.push/redirect) targets point at existing routes", () => {
    const broken = PROGRAMMATIC_NAV.filter((href) => !isValidRoute(href));
    expect(
      broken,
      `programmatic navigation targets with no matching page route: ${broken.join(", ")}`,
    ).toEqual([]);
  });
});
