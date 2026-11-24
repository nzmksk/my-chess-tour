import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  ON_BEHALF_CONSENT_HISTORY,
  ORGANIZER_AGREEMENT_HISTORY,
  ORGANIZER_AGREEMENT_VERSION,
  SENSITIVE_DATA_CONSENT_HISTORY,
  TERMS_HISTORY,
  TERMS_VERSION,
  changesSince,
  currentConsent,
  formatLegalVersion,
  onBehalfConsent,
  isSensitiveDataCategory,
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

describe("current_organizer_agreement_version()", () => {
  it("matches ORGANIZER_AGREEMENT_VERSION", () => {
    const dir = path.join(process.cwd(), "supabase/migrations");
    const versions = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .flatMap((file) =>
        [
          ...fs
            .readFileSync(path.join(dir, file), "utf-8")
            .matchAll(
              /FUNCTION current_organizer_agreement_version\(\)[\s\S]*?SELECT '([^']+)'/g,
            ),
        ].map((match) => match[1]),
      );
    expect(versions.at(-1)).toBe(ORGANIZER_AGREEMENT_VERSION);
  });
});

describe("formatLegalVersion", () => {
  it("renders a version as the date shown under a document title", () => {
    expect(formatLegalVersion("2026-08-02")).toBe("2 August 2026");
    expect(formatLegalVersion("2025-06-01")).toBe("1 June 2025");
    expect(formatLegalVersion("2026-12-25")).toBe("25 December 2026");
  });

  it("does not shift the day (calendar date, not an instant)", () => {
    expect(formatLegalVersion("2026-01-01")).toBe("1 January 2026");
    expect(formatLegalVersion("2026-12-31")).toBe("31 December 2026");
  });

  it("renders both live constants without falling back", () => {
    for (const version of Object.values(VERSIONS)) {
      expect(formatLegalVersion(version)).not.toBe(version);
    }
  });

  it("returns malformed input unchanged rather than throwing", () => {
    expect(formatLegalVersion("v1.2.3")).toBe("v1.2.3");
    expect(formatLegalVersion("")).toBe("");
    expect(formatLegalVersion("2026-13-02")).toBe("2026-13-02");
  });
});

describe("version histories", () => {
  it.each(Object.entries(HISTORIES))("%s is newest first", (_name, history) => {
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

describe("sensitive data consent statements", () => {
  it.each(Object.entries(SENSITIVE_DATA_CONSENT_HISTORY))(
    "%s is newest first, with date-shaped unique versions",
    (_category, history) => {
      const versions = history.map((entry) => entry.version);
      expect(versions.length).toBeGreaterThan(0);
      expect(versions).toEqual([...versions].sort().reverse());
      expect(new Set(versions).size).toBe(versions.length);
      for (const entry of history) {
        expect(entry.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(formatLegalVersion(entry.version)).not.toBe(entry.version);
        expect(entry.statement.trim().length).toBeGreaterThan(0);
      }
    },
  );

  it("currentConsent returns the newest statement", () => {
    expect(currentConsent("health")).toBe(
      SENSITIVE_DATA_CONSENT_HISTORY.health[0],
    );
    expect(currentConsent("financial")).toBe(
      SENSITIVE_DATA_CONSENT_HISTORY.financial[0],
    );
  });

  it("each statement says how to withdraw", () => {
    expect(currentConsent("health").statement).toMatch(/withdraw/i);
    expect(currentConsent("financial").statement).toMatch(/withdraw/i);
  });

  it("isSensitiveDataCategory accepts exactly the database enum values", () => {
    expect(isSensitiveDataCategory("health")).toBe(true);
    expect(isSensitiveDataCategory("financial")).toBe(true);
    expect(isSensitiveDataCategory("terms")).toBe(false);
    expect(isSensitiveDataCategory(undefined)).toBe(false);
  });

  it("categories match the sensitive_data_category enum", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "supabase/migrations/001_tables.sql"),
      "utf-8",
    );
    const match = sql.match(
      /CREATE TYPE sensitive_data_category AS ENUM \(([^)]*)\)/,
    );
    const values = match?.[1].match(/'([^']+)'/g)?.map((v) => v.slice(1, -1));
    expect(values?.sort()).toEqual(
      Object.keys(SENSITIVE_DATA_CONSENT_HISTORY).sort(),
    );
  });
});

describe("consent recorded on a player's behalf (#717)", () => {
  const cases = (["health", "financial"] as const).flatMap((category) =>
    (["minor", "authorised", "appointed"] as const).map(
      (basis) => [category, basis] as const,
    ),
  );

  it.each(cases)(
    "%s / %s has a dated, newest-first history",
    (category, basis) => {
      const history = ON_BEHALF_CONSENT_HISTORY[category][basis];
      expect(history.length).toBeGreaterThan(0);
      for (const entry of history) {
        expect(entry.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(entry.statement.trim().length).toBeGreaterThan(0);
      }
      const versions = history.map((entry) => entry.version);
      expect(versions).toEqual([...versions].sort().reverse());
      expect(onBehalfConsent(category, basis)).toBe(history[0]);
    },
  );

  it.each(["health", "financial"] as const)(
    "a guardian of a minor consents on the child's behalf, a helper records the player's agreement (%s)",
    (category) => {
      expect(onBehalfConsent(category, "minor").statement).toMatch(
        /^As this player's parent or legal guardian, I consent on their behalf/,
      );
      expect(onBehalfConsent(category, "authorised").statement).toMatch(
        /^This player has agreed to/,
      );
      expect(onBehalfConsent(category, "authorised").statement).toMatch(
        /asked me to record that for them/,
      );
    },
  );
});
