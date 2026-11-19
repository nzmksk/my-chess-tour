import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangelogEntry } from "@/lib/changelog";

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

const { mockLoadChangelog } = vi.hoisted(() => ({
  mockLoadChangelog: vi.fn(),
}));
vi.mock("@/services/github/releases", () => ({
  loadChangelog: mockLoadChangelog,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ChangelogsPage, { metadata } from "../page";

const ENTRIES: ChangelogEntry[] = [
  {
    version: "v0.11.0-alpha",
    date: "2026-11-19",
    headline: "Tournaments up front.",
    new: ["A bug report button."],
    fixed: ["A broken link."],
  },
  {
    version: "v0.10.0-alpha",
    date: "2026-11-18",
    improved: ["Faster pages."],
  },
  {
    version: "v0.9.6-alpha",
    date: "2026-11-15",
    silent: true,
    improved: ["Behind-the-scenes improvements."],
  },
];

/** 25 releases, v0.25.0-alpha down to v0.1.0-alpha. */
const MANY: ChangelogEntry[] = Array.from({ length: 25 }, (_, i) => ({
  version: `v0.${25 - i}.0-alpha`,
  date: "2026-11-01",
  new: [`Change ${25 - i}.`],
}));

async function render(page?: string | string[]) {
  const element = await ChangelogsPage({
    searchParams: Promise.resolve(page === undefined ? {} : { page }),
  });
  return renderToStaticMarkup(element);
}

describe("/changelogs", () => {
  beforeEach(() => {
    mockLoadChangelog.mockResolvedValue(ENTRIES);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("has page metadata", () => {
    expect(metadata.title).toBe("Changelog");
    expect(metadata.description).toBeTruthy();
  });

  it("lists every release newest first, silent ones included", async () => {
    const html = await render();
    const order = ["v0.11.0-alpha", "v0.10.0-alpha", "v0.9.6-alpha"].map(
      (version) => html.indexOf(`id="${version}"`),
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("gives each release an anchor link", async () => {
    expect(await render()).toContain('href="#v0.10.0-alpha"');
  });

  it("shows the date, headline and grouped items", async () => {
    const html = await render();
    expect(html).toContain('dateTime="2026-11-19"');
    expect(html).toContain("19 November 2026");
    expect(html).toContain("Tournaments up front.");
    expect(html).toContain(">New</h3>");
    expect(html).toContain(">Fixed</h3>");
    expect(html).toContain("A bug report button.");
  });

  it("leaves out empty groups", async () => {
    const html = await render();
    expect(html.match(/>Improved<\/h3>/g)).toHaveLength(2);
    expect(html.match(/>New<\/h3>/g)).toHaveLength(1);
  });

  it("says something for a release with no notes", async () => {
    mockLoadChangelog.mockResolvedValue([
      { version: "v0.9.6-alpha", date: "2026-11-15", silent: true },
    ]);
    expect(await render()).toContain("Behind-the-scenes improvements.");
  });

  it("hides a release this build doesn't carry yet", async () => {
    vi.stubEnv("APP_VERSION", "v0.10.0-alpha");
    const html = await render();
    expect(html).not.toContain('id="v0.11.0-alpha"');
    expect(html).toContain('id="v0.10.0-alpha"');
  });

  it("marks the newest listed release as the latest", async () => {
    vi.stubEnv("APP_VERSION", "v0.10.0-alpha");
    const html = await render();
    expect(html.match(/Latest/g)).toHaveLength(1);
    expect(html.indexOf("Latest")).toBeGreaterThan(
      html.indexOf('id="v0.10.0-alpha"'),
    );
  });

  it("explains when the releases can't be loaded", async () => {
    mockLoadChangelog.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain("couldn&#x27;t load the changelog");
    expect(html).toContain(
      'href="https://github.com/nzmksk/my-chess-tour/releases"',
    );
  });

  it("says so when there are no releases", async () => {
    mockLoadChangelog.mockResolvedValue([]);
    expect(await render()).toContain("No releases yet.");
  });

  it("has no page links when everything fits on one page", async () => {
    expect(await render()).not.toContain("Changelog pages");
  });

  describe("with more than ten releases", () => {
    beforeEach(() => {
      mockLoadChangelog.mockResolvedValue(MANY);
    });

    it("shows the newest ten on the first page", async () => {
      const html = await render();
      expect(html.match(/<article/g)).toHaveLength(10);
      expect(html).toContain('id="v0.25.0-alpha"');
      expect(html).toContain('id="v0.16.0-alpha"');
      expect(html).not.toContain('id="v0.15.0-alpha"');
      expect(html).toContain("Page 1 of 3");
      expect(html).toContain('href="/changelogs?page=2"');
      expect(html).not.toContain(">Newer<");
    });

    it("links both ways from a middle page", async () => {
      const html = await render("2");
      expect(html).toContain('id="v0.15.0-alpha"');
      expect(html).toContain('id="v0.6.0-alpha"');
      expect(html).toContain("Page 2 of 3");
      expect(html).toMatch(/href="\/changelogs"[^>]*>Newer</);
      expect(html).toMatch(/href="\/changelogs\?page=3"[^>]*>Older</);
    });

    it("shows the rest on the last page", async () => {
      const html = await render("3");
      expect(html.match(/<article/g)).toHaveLength(5);
      expect(html).toContain('id="v0.1.0-alpha"');
      expect(html).not.toContain(">Older<");
    });

    it("marks only the newest release as the latest", async () => {
      expect(await render("2")).not.toContain("Latest");
    });

    it("counts pages from the releases this build carries", async () => {
      vi.stubEnv("APP_VERSION", "v0.20.0-alpha");
      const html = await render();
      expect(html).toContain('id="v0.20.0-alpha"');
      expect(html).toContain("Page 1 of 2");
    });

    it("answers 404 past the last page", async () => {
      await expect(render("4")).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it.each(["0", "abc", "1.5"])("answers 404 for page %j", async (page) => {
      await expect(render(page)).rejects.toThrow("NEXT_NOT_FOUND");
    });
  });
});
