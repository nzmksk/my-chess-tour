// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import ProfileNudge from "../ProfileNudge";

const DISMISS_KEY = "mct.profileNudgeDismissed";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe("ProfileNudge", () => {
  it("renders the nudge with a link to settings when not dismissed", () => {
    render(<ProfileNudge />);
    const link = screen.getByText("Complete profile →");
    expect(link.getAttribute("href")).toBe("/settings");
  });

  it("renders nothing when previously dismissed", () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    const { container } = render(<ProfileNudge />);
    expect(container.textContent).toBe("");
  });

  it("hides itself and persists dismissal when the close button is clicked", () => {
    const { container } = render(<ProfileNudge />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(container.textContent).toBe("");
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
  });
});
