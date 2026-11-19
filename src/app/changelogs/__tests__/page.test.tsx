import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("@/content/changelog", () => ({
  CHANGELOG: [
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
  ],
}));

import ChangelogsPage, { metadata } from "../page";

describe("/changelogs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("has page metadata", () => {
    expect(metadata.title).toBe("Changelog");
    expect(metadata.description).toBeTruthy();
  });

  it("lists every release newest first, silent ones included", () => {
    const html = renderToStaticMarkup(<ChangelogsPage />);
    const order = ["v0.11.0-alpha", "v0.10.0-alpha", "v0.9.6-alpha"].map(
      (version) => html.indexOf(`id="${version}"`),
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("gives each release an anchor link", () => {
    const html = renderToStaticMarkup(<ChangelogsPage />);
    expect(html).toContain('href="#v0.10.0-alpha"');
  });

  it("shows the date, headline and grouped items", () => {
    const html = renderToStaticMarkup(<ChangelogsPage />);
    expect(html).toContain('dateTime="2026-11-19"');
    expect(html).toContain("19 November 2026");
    expect(html).toContain("Tournaments up front.");
    expect(html).toContain(">New</h3>");
    expect(html).toContain(">Fixed</h3>");
    expect(html).toContain("A bug report button.");
  });

  it("leaves out empty groups", () => {
    const html = renderToStaticMarkup(<ChangelogsPage />);
    expect(html.match(/>Improved<\/h3>/g)).toHaveLength(2);
    expect(html.match(/>New<\/h3>/g)).toHaveLength(1);
  });

  it("hides a release this build doesn't carry yet", () => {
    vi.stubEnv("APP_VERSION", "v0.10.0-alpha");
    const html = renderToStaticMarkup(<ChangelogsPage />);
    expect(html).not.toContain('id="v0.11.0-alpha"');
    expect(html).toContain('id="v0.10.0-alpha"');
  });

  it("marks the newest listed release as the latest", () => {
    vi.stubEnv("APP_VERSION", "v0.10.0-alpha");
    const html = renderToStaticMarkup(<ChangelogsPage />);
    expect(html.match(/Latest/g)).toHaveLength(1);
    expect(html.indexOf("Latest")).toBeGreaterThan(
      html.indexOf('id="v0.10.0-alpha"'),
    );
  });
});
