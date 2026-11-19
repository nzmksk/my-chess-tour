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

import {
  LAST_SEEN_KEY,
  WhatsNew,
  fetchMissedReleases,
  isQuietPath,
} from "../WhatsNew";

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

const load = vi.fn<(after: string) => Promise<readonly ChangelogEntry[]>>();

function renderAt(pathname: string, version = "v0.11.0-alpha") {
  mockPathname.current = pathname;
  return render(<WhatsNew version={version} loadEntries={load} />);
}

function dialog() {
  return screen.queryByRole("dialog");
}

describe("WhatsNew", () => {
  beforeEach(() => {
    window.localStorage.clear();
    load.mockReset().mockResolvedValue(ENTRIES);
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

  it("skips a silent release but still remembers it", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    load.mockResolvedValue([{ ...ENTRIES[0], silent: true }]);
    renderAt("/");
    await waitFor(() =>
      expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("v0.11.0-alpha"),
    );
    expect(dialog()).toBeNull();
  });

  it("fetches only the releases since the last one seen", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    renderAt("/");
    await screen.findByRole("dialog");
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("v0.10.0-alpha");
  });

  it("fetches nothing on a first visit or when up to date", () => {
    renderAt("/");
    cleanup();
    renderAt("/");
    expect(load).not.toHaveBeenCalled();
  });

  it("stays quiet and stores nothing when the releases can't be loaded", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    load.mockRejectedValue(new Error("503"));
    renderAt("/");
    await waitFor(() => expect(load).toHaveBeenCalled());
    await Promise.resolve();
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("v0.10.0-alpha");
  });

  it("tries again on the next page after the releases failed to load", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    load.mockRejectedValueOnce(new Error("503"));
    const { rerender } = renderAt("/");
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(dialog()).toBeNull();

    mockPathname.current = "/my";
    rerender(<WhatsNew version="v0.11.0-alpha" loadEntries={load} />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("decides again later when the visitor leaves for checkout mid-load", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    let resolveFirst: (entries: readonly ChangelogEntry[]) => void = () => {};
    load.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const { rerender } = renderAt("/tournaments/kl-open");

    mockPathname.current = "/tournaments/kl-open/register";
    rerender(<WhatsNew version="v0.11.0-alpha" loadEntries={load} />);
    resolveFirst(ENTRIES);
    await Promise.resolve();
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("v0.10.0-alpha");

    mockPathname.current = "/my";
    rerender(<WhatsNew version="v0.11.0-alpha" loadEntries={load} />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does nothing on a build without a release version", () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    renderAt("/", "dev");
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("v0.10.0-alpha");
  });

  it("stays quiet through sign-in on the way to checkout", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    const { rerender } = renderAt("/auth/login");
    expect(dialog()).toBeNull();

    mockPathname.current = "/tournaments/kl-open/register";
    rerender(<WhatsNew version="v0.11.0-alpha" loadEntries={load} />);
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("v0.10.0-alpha");

    mockPathname.current = "/tournaments/kl-open/register/success";
    rerender(<WhatsNew version="v0.11.0-alpha" loadEntries={load} />);
    expect(dialog()).toBeNull();

    mockPathname.current = "/my";
    rerender(<WhatsNew version="v0.11.0-alpha" loadEntries={load} />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("waits out a quiet flow, then shows on the next ordinary page", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
    const { rerender } = renderAt("/tournaments/kl-open/register");
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("v0.10.0-alpha");

    mockPathname.current = "/my";
    rerender(<WhatsNew version="v0.11.0-alpha" loadEntries={load} />);
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

    it("shows nothing when the version can't be saved", async () => {
      window.localStorage.setItem(LAST_SEEN_KEY, "v0.10.0-alpha");
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      renderAt("/");
      await waitFor(() => expect(load).toHaveBeenCalled());
      await Promise.resolve();
      expect(dialog()).toBeNull();
    });
  });
});

describe("fetchMissedReleases", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the API for the releases after the given one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { entries: ENTRIES } })),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchMissedReleases("v0.10.0-alpha")).toEqual(ENTRIES);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/changelog?after=v0.10.0-alpha",
    );
  });

  it("throws when the API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );
    await expect(fetchMissedReleases("v0.10.0-alpha")).rejects.toThrow("503");
  });
});

describe("isQuietPath", () => {
  it.each([
    "/tournaments/kl-open/register",
    "/tournaments/kl-open/register/success",
    "/tournaments/kl-open/register/failure",
    "/auth/login",
    "/auth/signup",
    "/auth/signup/verify",
    "/auth/forgot-password",
    "/auth/update-password",
    "/prize-funding/thank-you",
  ])("keeps %s quiet", (pathname) => {
    expect(isQuietPath(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/tournaments/kl-open",
    "/tournaments/registered-players",
    "/authors",
    "/my",
    "/changelogs",
  ])("allows %s", (pathname) => {
    expect(isQuietPath(pathname)).toBe(false);
  });
});
