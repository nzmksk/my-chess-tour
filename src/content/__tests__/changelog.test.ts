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
