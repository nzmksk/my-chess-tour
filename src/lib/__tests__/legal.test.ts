import { describe, it, expect } from "vitest";
import {
  ORGANIZER_AGREEMENT_HISTORY,
  ORGANIZER_AGREEMENT_VERSION,
  TERMS_HISTORY,
  TERMS_VERSION,
  changesSince,
  formatLegalVersion,
} from "../legal";

const VERSIONS = {
  TERMS_VERSION,
  ORGANIZER_AGREEMENT_VERSION,
};

const HISTORIES = {
  TERMS_HISTORY,
  ORGANIZER_AGREEMENT_HISTORY,
};

describe("legal version constants", () => {
  it.each(Object.entries(VERSIONS))("%s is date-shaped", (_name, version) => {
    // The value is written verbatim into a varchar(20) column and compared for
    // equality to decide whether a payout may proceed, so its shape is a
    // contract, not cosmetics.
    expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(Object.entries(VERSIONS))(
    "%s fits the varchar(20) column",
    (_name, version) => {
      expect(version.length).toBeGreaterThan(0);
      expect(version.length).toBeLessThanOrEqual(20);
    },
  );

  it.each(Object.entries(VERSIONS))(
    "%s is a real calendar date",
    (_name, version) => {
      const [year, month, day] = version.split("-").map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      expect(parsed.getUTCFullYear()).toBe(year);
      expect(parsed.getUTCMonth()).toBe(month - 1);
      expect(parsed.getUTCDate()).toBe(day);
    },
  );
});

describe("formatLegalVersion", () => {
  it("renders a version as the date shown under a document title", () => {
    expect(formatLegalVersion("2026-08-02")).toBe("2 August 2026");
    expect(formatLegalVersion("2025-06-01")).toBe("1 June 2025");
    expect(formatLegalVersion("2026-12-25")).toBe("25 December 2026");
  });

  it("does not shift the day (calendar date, not an instant)", () => {
    // Parsing "2026-01-01" into a Date and formatting it in a negative-offset
    // zone would print 31 December. These are calendar dates and must not move.
    expect(formatLegalVersion("2026-01-01")).toBe("1 January 2026");
    expect(formatLegalVersion("2026-12-31")).toBe("31 December 2026");
  });

  it("renders both live constants without falling back", () => {
    for (const version of Object.values(VERSIONS)) {
      expect(formatLegalVersion(version)).not.toBe(version);
    }
  });

  it("returns malformed input unchanged rather than throwing", () => {
    // A bad constant should surface as odd text on the page, never as a render
    // crash on a document users are required to read.
    expect(formatLegalVersion("v1.2.3")).toBe("v1.2.3");
    expect(formatLegalVersion("")).toBe("");
    expect(formatLegalVersion("2026-13-02")).toBe("2026-13-02");
  });
});

describe("version histories", () => {
  it.each(Object.entries(HISTORIES))("%s is newest first", (_name, history) => {
    // changesSince relies on string comparison of ISO dates and on entry 0
    // being current. An out-of-order history would silently send the wrong
    // changelog to everyone.
    const versions = history.map((entry) => entry.version);
    const sorted = [...versions].sort().reverse();
    expect(versions).toEqual(sorted);
  });

  it.each(Object.entries(HISTORIES))(
    "%s has no duplicate versions",
    (_name, history) => {
      const versions = history.map((entry) => entry.version);
      expect(new Set(versions).size).toBe(versions.length);
    },
  );

  it.each(Object.entries(HISTORIES))(
    "%s describes every version",
    (_name, history) => {
      for (const entry of history) {
        expect(entry.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(entry.changes.length).toBeGreaterThan(0);
        for (const change of entry.changes) {
          expect(change.trim().length).toBeGreaterThan(0);
        }
      }
    },
  );

  it("derives the current version from the newest entry", () => {
    expect(TERMS_VERSION).toBe(TERMS_HISTORY[0].version);
    expect(ORGANIZER_AGREEMENT_VERSION).toBe(
      ORGANIZER_AGREEMENT_HISTORY[0].version,
    );
  });
});

describe("changesSince", () => {
  const HISTORY = [
    { version: "2026-08-02", changes: ["c3a", "c3b"] },
    { version: "2026-03-01", changes: ["c2"] },
    { version: "2025-06-01", changes: ["c1"] },
  ];

  it("returns nothing for a reader already on the current version", () => {
    expect(changesSince(HISTORY, "2026-08-02")).toEqual([]);
  });

  it("covers every version a reader skipped, not just the latest", () => {
    // The whole reason the history exists: someone two versions behind must be
    // told about both, and a single-release summary would be wrong for them.
    expect(changesSince(HISTORY, "2025-06-01")).toEqual(["c3a", "c3b", "c2"]);
  });

  it("returns the whole history when no version was ever accepted", () => {
    expect(changesSince(HISTORY, null)).toEqual(["c3a", "c3b", "c2", "c1"]);
  });

  it("treats an unknown older version as behind everything after it", () => {
    expect(changesSince(HISTORY, "2020-01-01")).toEqual([
      "c3a",
      "c3b",
      "c2",
      "c1",
    ]);
  });

  it("orders changes newest first", () => {
    const [first] = changesSince(HISTORY, "2025-06-01");
    expect(first).toBe("c3a");
  });

  it("works on the real histories without throwing", () => {
    expect(changesSince(TERMS_HISTORY, TERMS_VERSION)).toEqual([]);
    expect(changesSince(TERMS_HISTORY, null).length).toBeGreaterThan(0);
    expect(
      changesSince(ORGANIZER_AGREEMENT_HISTORY, ORGANIZER_AGREEMENT_VERSION),
    ).toEqual([]);
  });
});
