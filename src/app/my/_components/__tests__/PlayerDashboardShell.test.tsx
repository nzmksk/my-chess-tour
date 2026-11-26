// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { mockPathname } = vi.hoisted(() => ({ mockPathname: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: mockPathname }));

import PlayerDashboardShell from "../PlayerDashboardShell";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function activeLinks() {
  return screen
    .getAllByRole("link")
    .filter((link) => link.className.includes("text-gold-bright bg-gold-ghost"))
    .map((link) => link.textContent);
}

describe("PlayerDashboardShell", () => {
  it("links to My Tournaments, Profile and Settings", () => {
    mockPathname.mockReturnValue("/my");
    render(<PlayerDashboardShell>content</PlayerDashboardShell>);
    expect(
      screen.getByRole("link", { name: "Settings" }).getAttribute("href"),
    ).toBe("/settings");
    expect(screen.getByText("content")).toBeDefined();
  });

  it.each([
    ["/my", "My Tournaments"],
    ["/profile", "Profile"],
    ["/settings", "Settings"],
    ["/settings/dependents", "Settings"],
  ])("highlights the section for %s", (pathname, label) => {
    mockPathname.mockReturnValue(pathname);
    render(<PlayerDashboardShell>content</PlayerDashboardShell>);
    expect(activeLinks()).toEqual([label]);
  });

  it("does not treat a lookalike path as Settings", () => {
    mockPathname.mockReturnValue("/settingsx");
    render(<PlayerDashboardShell>content</PlayerDashboardShell>);
    expect(activeLinks()).toEqual([]);
  });
});
