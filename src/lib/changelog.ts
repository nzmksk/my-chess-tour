export interface ChangelogEntry {
  version: string;
  date: string;
  headline?: string;
  silent?: boolean;
  new?: readonly string[];
  improved?: readonly string[];
  fixed?: readonly string[];
}

export const CHANGE_GROUPS = [
  { key: "new", label: "New" },
  { key: "improved", label: "Improved" },
  { key: "fixed", label: "Fixed" },
] as const satisfies readonly {
  key: keyof ChangelogEntry;
  label: string;
}[];

const VERSION_PATTERN =
  /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

export function isReleaseVersion(version: string): boolean {
  return parseVersion(version) !== null;
}

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`Not a release version: ${pa ? b : a}`);

  for (let i = 0; i < 3; i++) {
    const diff = pa.core[i] - pb.core[i];
    if (diff !== 0) return Math.sign(diff);
  }

  if (!pa.prerelease.length || !pb.prerelease.length) {
    return Math.sign(pb.prerelease.length - pa.prerelease.length);
  }
  const length = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < length; i++) {
    if (pa.prerelease[i] === undefined) return -1;
    if (pb.prerelease[i] === undefined) return 1;
    const diff = compareIdentifiers(pa.prerelease[i], pb.prerelease[i]);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function releasedEntries(
  entries: readonly ChangelogEntry[],
  currentVersion: string,
): ChangelogEntry[] {
  if (!isReleaseVersion(currentVersion)) return [...entries];
  return entries.filter(
    (entry) => compareVersions(entry.version, currentVersion) <= 0,
  );
}

const CHANGELOG_PAGE_SIZE = 10;

export function parsePageParam(
  value: string | string[] | undefined,
): number | null {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) return null;
  return Number(value);
}

export interface ChangelogPage {
  entries: ChangelogEntry[];
  page: number;
  pageCount: number;
}

export function paginateEntries(
  entries: readonly ChangelogEntry[],
  page: number,
  pageSize = CHANGELOG_PAGE_SIZE,
): ChangelogPage | null {
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  if (page < 1 || page > pageCount) return null;
  const start = (page - 1) * pageSize;
  return {
    entries: entries.slice(start, start + pageSize),
    page,
    pageCount,
  };
}

export type Announcement =
  | { kind: "none" }
  | { kind: "remember" }
  | { kind: "show"; entry: ChangelogEntry; missed: number };

export function hasMissedRelease(
  lastSeen: string | null,
  currentVersion: string,
): boolean {
  return (
    isReleaseVersion(currentVersion) &&
    lastSeen !== null &&
    isReleaseVersion(lastSeen) &&
    compareVersions(lastSeen, currentVersion) < 0
  );
}

export function pickAnnouncement(
  lastSeen: string | null,
  currentVersion: string,
  entries: readonly ChangelogEntry[],
): Announcement {
  if (!isReleaseVersion(currentVersion)) return { kind: "none" };
  if (lastSeen === null || !isReleaseVersion(lastSeen)) {
    return { kind: "remember" };
  }
  if (compareVersions(lastSeen, currentVersion) >= 0) return { kind: "none" };

  const unseen = entries.filter(
    (entry) =>
      compareVersions(entry.version, lastSeen) > 0 &&
      compareVersions(entry.version, currentVersion) <= 0,
  );
  const announced = unseen
    .filter((entry) => !entry.silent)
    .sort((a, b) => compareVersions(b.version, a.version))[0];

  if (!announced) return { kind: "remember" };
  return { kind: "show", entry: announced, missed: unseen.length };
}
