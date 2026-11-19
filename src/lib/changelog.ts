/**
 * The user-facing changelog (#622): types and the pure rules for which
 * releases to list and which one to announce. The entries themselves live in
 * src/content/changelog.ts. Safe for client components: no Node APIs.
 */

export interface ChangelogEntry {
  /** The release's git tag, exactly as the footer shows it (#621). */
  version: string;
  /** Release date, YYYY-MM-DD. */
  date: string;
  /** Optional one-line summary shown above the items. */
  headline?: string;
  /**
   * No user-visible changes worth interrupting anyone for: listed on
   * /changelogs, but never announced in the "What's new" dialog.
   */
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

/** True for a release tag such as `v0.11.0-alpha`; false for `dev` or junk. */
export function isReleaseVersion(version: string): boolean {
  return parseVersion(version) !== null;
}

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  // Semver: numeric identifiers sort before alphanumeric ones.
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Semver precedence of two release tags: negative when `a` is older, positive
 * when newer, 0 when equal. A pre-release sorts before its release
 * (`v1.0.0-alpha` < `v1.0.0`). Throws on anything that isn't a release tag;
 * check untrusted input with isReleaseVersion first.
 */
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

/**
 * The entries a build may show: those released at or before `currentVersion`.
 * An entry written ahead of its tag (the release PR merges before the tag is
 * cut) stays hidden until a build that carries the tag. A build without a
 * release version (`dev`, locally) shows everything, unreleased included.
 */
export function releasedEntries(
  entries: readonly ChangelogEntry[],
  currentVersion: string,
): ChangelogEntry[] {
  if (!isReleaseVersion(currentVersion)) return [...entries];
  return entries.filter(
    (entry) => compareVersions(entry.version, currentVersion) <= 0,
  );
}

export type Announcement =
  /** Leave storage alone and show nothing. */
  | { kind: "none" }
  /** Store the current version without showing anything. */
  | { kind: "remember" }
  /** Show `entry`; `missed` counts every release since the last one seen. */
  | { kind: "show"; entry: ChangelogEntry; missed: number };

/**
 * Decides what the "What's new" dialog does on this visit.
 *
 * - First visit (nothing stored, or something unreadable): remember the
 *   current version quietly, so new visitors aren't greeted by release notes.
 * - Already seen this release (or a newer one): nothing.
 * - Otherwise announce the newest unseen release that isn't silent, once,
 *   however many releases were skipped. If every unseen one is silent,
 *   remember the current version quietly.
 */
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
