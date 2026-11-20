// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ApplicationsClient from "../ApplicationsClient";
import type { OrgApplication } from "../../types";

afterEach(cleanup);

function application(overrides: Partial<OrgApplication>): OrgApplication {
  return {
    id: "bbbbbbbb-0000-0000-0000-000000000001",
    name: "KL Chess Association",
    approval_status: "pending",
    rejection_reason: null,
    created_at: "2026-11-01T00:00:00Z",
    reviewed_at: null,
    ...overrides,
  };
}

describe("ApplicationsClient", () => {
  it("offers to amend and resubmit a rejected application (#582)", () => {
    render(
      <ApplicationsClient
        applications={[
          application({
            approval_status: "rejected",
            rejection_reason: "SSM certificate unreadable",
            reviewed_at: "2026-11-02T00:00:00Z",
          }),
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: "Amend & Resubmit" });
    expect(link.getAttribute("href")).toBe(
      "/my/organizations/applications/bbbbbbbb-0000-0000-0000-000000000001/amend",
    );
    expect(screen.getByText("SSM certificate unreadable")).toBeDefined();
  });

  it("offers no amend link on pending or approved applications", () => {
    render(
      <ApplicationsClient
        applications={[
          application({ id: "b1", approval_status: "pending" }),
          application({
            id: "b2",
            name: "Penang Chess Club",
            approval_status: "approved",
          }),
        ]}
      />,
    );

    expect(screen.queryByRole("link", { name: "Amend & Resubmit" })).toBeNull();
  });

  it("still links to a brand-new application", () => {
    render(<ApplicationsClient applications={[application({})]} />);
    expect(
      screen
        .getByRole("link", { name: "New Application" })
        .getAttribute("href"),
    ).toBe("/organizations/apply");
  });
});
