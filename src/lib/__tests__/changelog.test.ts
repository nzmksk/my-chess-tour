import { describe, it, expect } from "vitest";
import {
  compareVersions,
  isReleaseVersion,
  paginateEntries,
  parsePageParam,
  pickAnnouncement,
  releasedEntries,
  type ChangelogEntry,
} from "../changelog";

function entry(version: string, extra: Partial<ChangelogEntry> = {}) {
  return { version, date: "2026-11-01", new: ["Something"], ...extra };
}

describe("isReleaseVersion", () => {
  it.each(["v0.11.0-alpha", "v1.0.0", "v1.2.3-beta.2", "v10.20.30-rc.1"])(
    "accepts %s",
    (version) => {
      expect(isReleaseVersion(version)).toBe(true);
    },
  );

  it.each(["dev", "", "0.11.0-alpha", "v1.0", "v1.0.0-", "v1.0.0+build"])(
    "rejects %j",
    (version) => {
      expect(isReleaseVersion(version)).toBe(false);
    },
  );
});

describe("compareVersions", () => {
  it.each([
    ["v0.9.6-alpha", "v0.10.0-alpha"],
    ["v0.10.0-alpha", "v0.10.1-alpha"],
    ["v0.10.0-alpha", "v1.0.0-alpha"],
    ["v1.0.0-alpha", "v1.0.0"],
    ["v1.0.0-alpha", "v1.0.0-beta"],
    ["v1.0.0-alpha", "v1.0.0-alpha.1"],
    ["v1.0.0-alpha.2", "v1.0.0-alpha.10"],
    ["v1.0.0-alpha.9", "v1.0.0-alpha.beta"],
  ])("orders %s before %s", (older, newer) => {
    expect(compareVersions(older, newer)).toBe(-1);
    expect(compareVersions(newer, older)).toBe(1);
  });

  it("treats identical versions as equal", () => {
    expect(compareVersions("v0.11.0-alpha", "v0.11.0-alpha")).toBe(0);
  });

  it("throws on a non-release version", () => {
    expect(() => compareVersions("dev", "v0.11.0-alpha")).toThrow(/dev/);
    expect(() => compareVersions("v0.11.0-alpha", "junk")).toThrow(/junk/);
  });
});

describe("releasedEntries", () => {
  const entries = [
    entry("v0.11.0-alpha"),
    entry("v0.10.0-alpha"),
    entry("v0.9.6-alpha"),
  ];

  it("hides entries written ahead of the current release", () => {
    expect(
      releasedEntries(entries, "v0.10.0-alpha").map((e) => e.version),
    ).toEqual(["v0.10.0-alpha", "v0.9.6-alpha"]);
  });

  it("shows everything to a build without a release version", () => {
    expect(releasedEntries(entries, "dev")).toHaveLength(3);
  });
});

describe("pickAnnouncement", () => {
  const entries = [
    entry("v0.11.0-alpha", { headline: "Newest" }),
    entry("v0.10.0-alpha"),
    entry("v0.9.6-alpha"),
  ];

  it("remembers the version quietly on a first visit", () => {
    expect(pickAnnouncement(null, "v0.11.0-alpha", entries)).toEqual({
      kind: "remember",
    });
  });

  it("treats an unreadable stored value like a first visit", () => {
    expect(pickAnnouncement("garbage", "v0.11.0-alpha", entries)).toEqual({
      kind: "remember",
    });
  });

  it("does nothing once the current release was seen", () => {
    expect(pickAnnouncement("v0.11.0-alpha", "v0.11.0-alpha", entries)).toEqual(
      { kind: "none" },
    );
  });

  it("does nothing when the stored version is newer (a rollback)", () => {
    expect(pickAnnouncement("v0.11.0-alpha", "v0.10.0-alpha", entries)).toEqual(
      { kind: "none" },
    );
  });

  it("does nothing on a build without a release version", () => {
    expect(pickAnnouncement("v0.9.6-alpha", "dev", entries)).toEqual({
      kind: "none",
    });
  });

  it("announces the release after the one last seen", () => {
    expect(pickAnnouncement("v0.10.0-alpha", "v0.11.0-alpha", entries)).toEqual(
      { kind: "show", entry: entries[0], missed: 1 },
    );
  });

  it("announces only the newest release when several were skipped", () => {
    expect(pickAnnouncement("v0.9.6-alpha", "v0.11.0-alpha", entries)).toEqual({
      kind: "show",
      entry: entries[0],
      missed: 2,
    });
  });

  it("never announces an entry newer than the current release", () => {
    expect(pickAnnouncement("v0.9.6-alpha", "v0.10.0-alpha", entries)).toEqual({
      kind: "show",
      entry: entries[1],
      missed: 1,
    });
  });

  it("skips a silent release in favour of an older unseen one", () => {
    const withSilent = [
      entry("v0.11.0-alpha", { silent: true }),
      ...entries.slice(1),
    ];
    expect(
      pickAnnouncement("v0.9.6-alpha", "v0.11.0-alpha", withSilent),
    ).toEqual({ kind: "show", entry: withSilent[1], missed: 2 });
  });

  it("remembers quietly when every unseen release is silent", () => {
    const withSilent = [
      entry("v0.11.0-alpha", { silent: true }),
      ...entries.slice(1),
    ];
    expect(
      pickAnnouncement("v0.10.0-alpha", "v0.11.0-alpha", withSilent),
    ).toEqual({ kind: "remember" });
  });
});

describe("parsePageParam", () => {
  it("defaults to the first page", () => {
    expect(parsePageParam(undefined)).toBe(1);
  });

  it.each([
    ["1", 1],
    ["2", 2],
    ["40", 40],
  ])("reads %j as page %i", (value, page) => {
    expect(parsePageParam(value)).toBe(page);
  });

  it.each(["", "0", "-1", "1.5", "01", "abc", "2abc", " 2", "1e3", "9999999"])(
    "rejects %j",
    (value) => {
      expect(parsePageParam(value)).toBeNull();
    },
  );

  it("rejects a repeated parameter", () => {
    expect(parsePageParam(["1", "2"])).toBeNull();
  });
});

describe("paginateEntries", () => {
  const entries = Array.from({ length: 23 }, (_, i) =>
    entry(`v0.${23 - i}.0-alpha`),
  );

  it("splits the entries into pages of ten", () => {
    const first = paginateEntries(entries, 1);
    expect(first?.entries.map((e) => e.version)).toEqual(
      entries.slice(0, 10).map((e) => e.version),
    );
    expect(first?.pageCount).toBe(3);
  });

  it("returns the remainder on the last page", () => {
    const last = paginateEntries(entries, 3);
    expect(last?.entries).toEqual(entries.slice(20));
    expect(last).toMatchObject({ page: 3, pageCount: 3 });
  });

  it("returns null past the last page", () => {
    expect(paginateEntries(entries, 4)).toBeNull();
    expect(paginateEntries(entries, 0)).toBeNull();
  });

  it("treats an empty changelog as one empty page", () => {
    expect(paginateEntries([], 1)).toEqual({
      entries: [],
      page: 1,
      pageCount: 1,
    });
    expect(paginateEntries([], 2)).toBeNull();
  });

  it("takes another page size", () => {
    expect(paginateEntries(entries, 2, 20)?.entries).toHaveLength(3);
  });
});
