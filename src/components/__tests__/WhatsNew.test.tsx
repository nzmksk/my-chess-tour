// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ChangelogEntry } from "@/lib/changelog";

const mockPathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.current,
}));

import { LAST_SEEN_KEY, WhatsNew, isQuietPath } from "../WhatsNew";

const ENTRIES: ChangelogEntry[] = [
  {
    version: "v0.11.0-alpha",
    date: "2026-11-19",
    headline: "Tournaments up front.",
    new: ["A bug report button."],
  },
  { version: "v0.10.0-alpha", date: "2026-11-18", fixed: ["A capacity bug."] },
  { version: "v0.9.6-alpha", date: "2026-11-15", improved: ["Safer edits."] },
];

function renderAt(pathname: string, version = "v0.11.0-alpha") {
  mockPathname.current = pathname;
  return render(<WhatsNew version={version} entries={ENTRIES} />);
}

function dialog() {
  return screen.queryByRole("dialog");
}

describe("WhatsNew", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("stays quiet on a first-ever visit and remembers the version", () => {
    renderAt("/");
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("v0.11.0-alpha");
  });

  it("shows the new release to a returning visitor, labelled by its title", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    renderAt("/");

    const shown = await screen.findByRole("dialog");
    expect(shown).toHaveProperty(
      "textContent",
      expect.stringContaining("A bug report button."),
    );
    const title = screen.getByText("v0.11.0-alpha");
    expect(shown.getAttribute("aria-labelledby")).toBe(title.id);
    expect(screen.getByText("Tournaments up front.")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "See all changes" })
        .getAttribute("href"),
    ).toBe("/changelogs");
  });

  it("shows it only once: not again after closing and reloading", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    renderAt("/");
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("v0.11.0-alpha");

    cleanup();
    renderAt("/");
    expect(dialog()).toBeNull();
  });

  it("closes on Escape", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    renderAt("/");
    const shown = await screen.findByRole("dialog");

    fireEvent.keyDown(shown, { key: "Escape" });
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("returns focus to where it was after closing", async () => {
    const before = document.createElement("button");
    document.body.appendChild(before);
    before.focus();

    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    renderAt("/");
    await screen.findByRole("dialog");
    expect(document.activeElement).not.toBe(before);

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(document.activeElement).toBe(before));
    before.remove();
  });

  it("shows one dialog for the newest release when several were skipped", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.9.6-alpha");
    renderAt("/");

    await screen.findByRole("dialog");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("v0.11.0-alpha")).toBeTruthy();
    expect(screen.queryByText("A capacity bug.")).toBeNull();
    expect(
      screen.getByText(/latest of 2 releases since your last visit/),
    ).toBeTruthy();
  });

  it("stays quiet when the visitor already saw this release", () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.11.0-alpha");
    renderAt("/");
    expect(dialog()).toBeNull();
  });

  it("skips a silent release but still remembers it", () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    mockPathname.current = "/";
    render(
      <WhatsNew
        version="v0.11.0-alpha"
        entries={[{ ...ENTRIES[0], silent: true }, ...ENTRIES.slice(1)]}
      />,
    );
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("v0.11.0-alpha");
  });

  it("does nothing on a build without a release version", () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    renderAt("/", "dev");
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("v0.10.0-alpha");
  });

  it("waits out a quiet flow, then shows on the next ordinary page", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    const { rerender } = renderAt("/tournaments/kl-open/register");
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("v0.10.0-alpha");

    mockPathname.current = "/my";
    rerender(<WhatsNew version="v0.11.0-alpha" entries={ENTRIES} />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  describe("with storage blocked", () => {
    it("shows nothing and doesn't crash when reading throws", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      renderAt("/");
      expect(dialog()).toBeNull();
    });

    it("shows nothing when the version can't be saved", () => {
      window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      renderAt("/");
      expect(dialog()).toBeNull();
    });
  });
});

describe("isQuietPath", () => {
  it.each([
    "/tournaments/kl-open/register",
    "/tournaments/kl-open/register/success",
    "/tournaments/kl-open/register/failure",
    "/auth/signup",
    "/auth/signup/verify",
    "/prize-funding/thank-you",
  ])("keeps %s quiet", (pathname) => {
    expect(isQuietPath(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/tournaments/kl-open",
    "/tournaments/registered-players",
    "/auth/login",
    "/my",
    "/changelogs",
  ])("allows %s", (pathname) => {
    expect(isQuietPath(pathname)).toBe(false);
  });
});
