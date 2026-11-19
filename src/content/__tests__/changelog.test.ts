import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { CHANGELOG } from "../changelog";
import {
  CHANGE_GROUPS,
  compareVersions,
  isReleaseVersion,
} from "@/lib/changelog";

describe("CHANGELOG", () => {
  it("names every entry by a release tag", () => {
    for (const entry of CHANGELOG) {
      expect(isReleaseVersion(entry.version), entry.version).toBe(true);
    }
  });

  it("lists releases newest first, each once", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      const newer = CHANGELOG[i - 1].version;
      const older = CHANGELOG[i].version;
      expect(compareVersions(newer, older), `${newer} before ${older}`).toBe(1);
    }
  });

  it("dates each release with a real YYYY-MM-DD date, never going back", () => {
    for (const [i, entry] of CHANGELOG.entries()) {
      expect(entry.date, entry.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const parsed = new Date(`${entry.date}T00:00:00Z`);
      expect(parsed.toISOString().slice(0, 10), entry.version).toBe(entry.date);
      if (i > 0) {
        expect(entry.date <= CHANGELOG[i - 1].date, entry.version).toBe(true);
      }
    }
  });

  it("gives every release at least one change, and no blank items", () => {
    for (const entry of CHANGELOG) {
      const items = CHANGE_GROUPS.flatMap(({ key }) => entry[key] ?? []);
      expect(items.length, entry.version).toBeGreaterThan(0);
      for (const item of items) expect(item.trim(), entry.version).not.toBe("");
    }
  });
});

/**
 * Every release tag reachable from the checked-out commit, including the one
 * the build reports as its version (#621), must have an entry. CI checks out
 * full history with tags (tests.yml) and also runs on each published release,
 * so a tag cut without an entry fails there. A local clone without tags
 * skips, rather than failing for a reason unrelated to the change.
 */
function reachableReleaseTags(): string[] {
  try {
    return execFileSync("git", ["tag", "--merged", "HEAD", "--list", "v*"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((tag) => tag.trim())
      .filter(isReleaseVersion);
  } catch {
    return [];
  }
}

describe("CHANGELOG against git tags", () => {
  const tags = reachableReleaseTags();

  it("can see the release tags in CI", () => {
    if (!process.env.CI) return;
    expect(
      tags.length,
      "No release tags found: CI must check out with fetch-depth: 0",
    ).toBeGreaterThan(0);
  });

  it.skipIf(tags.length === 0)("has an entry for every release tag", () => {
    const versions = new Set(CHANGELOG.map((entry) => entry.version));
    const missing = tags.filter((tag) => !versions.has(tag));
    expect(missing, "Add these releases to src/content/changelog.ts").toEqual(
      [],
    );
  });
});
