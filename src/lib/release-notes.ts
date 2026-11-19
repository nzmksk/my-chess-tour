/**
 * The GitHub release notes are the changelog (#640): this turns a release
 * into a ChangelogEntry. Pure, so the parsing rules are tested without
 * GitHub; src/services/github/releases.ts does the fetching.
 *
 * The notes are written for players and organizers, in this shape:
 *
 *     Optional one-line headline.
 *
 *     ### New
 *     - What people can do now that they couldn't before.
 *     ### Improved
 *     - What works better.
 *     ### Fixed
 *     - What was broken and now works.
 *
 *     <!-- developer notes -->
 *     ## What's Changed
 *     * PR titles from GitHub's "Generate release notes" ...
 *
 * Everything from the developer notes marker on is never shown. GitHub's own
 * generated sections ("## What's Changed", "**Full Changelog**") end the
 * user-facing part too, so a release published before anyone wrote notes
 * shows nothing rather than a list of PR titles. Items are plain text:
 * links keep their text, and bold or code formatting is dropped.
 */

import {
  CHANGE_GROUPS,
  isReleaseVersion,
  type ChangelogEntry,
} from "@/lib/changelog";
import { toCalendarDateInTimeZone } from "@/lib/tournaments/datetime";

type ChangeKey = (typeof CHANGE_GROUPS)[number]["key"];

/** The part of a release's notes the site shows. */
export type ReleaseNotes = Omit<ChangelogEntry, "version" | "date">;

const END_OF_USER_NOTES = [
  // <!-- developer notes -->: where the notes for users end.
  /<!--\s*developer notes\s*-->/i,
  // GitHub's "Generate release notes" output.
  /^#{1,6}[ \t]+What's Changed[ \t]*$/im,
  /^#{1,6}[ \t]+New Contributors[ \t]*$/im,
  /^\*\*Full Changelog\*\*/m,
];

// <!-- silent -->: list the release on /changelogs, but never announce it in
// the "What's new" dialog. A release with no items is silent without it.
const SILENT_PATTERN = /<!--\s*silent\s*-->/i;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/;
const LIST_ITEM = /^ {0,3}[-*+][ \t]+(.*)$/;

/** The notes up to where the developer notes begin, with \n line endings. */
function userNotes(body: string | null | undefined): string {
  const text = (body ?? "").replace(/\r\n?/g, "\n");
  let end = text.length;
  for (const pattern of END_OF_USER_NOTES) {
    const match = pattern.exec(text);
    if (match && match.index < end) end = match.index;
  }
  return text.slice(0, end);
}

/** Markdown inline formatting → the plain text the site renders. */
function plainText(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function groupFor(heading: string): ChangeKey | null {
  const label = plainText(heading).toLowerCase();
  return (
    CHANGE_GROUPS.find((group) => group.label.toLowerCase() === label)?.key ??
    null
  );
}

export function parseReleaseNotes(
  body: string | null | undefined,
): ReleaseNotes {
  const text = userNotes(body);
  const silent = SILENT_PATTERN.test(text);

  const headline: string[] = [];
  const groups: Record<ChangeKey, string[]> = {
    new: [],
    improved: [],
    fixed: [],
  };
  let seenHeading = false;
  // The group items are going into; null under a heading that isn't one.
  let group: ChangeKey | null = null;
  // The item a wrapped line continues, until a blank line ends it.
  let open: { items: string[]; index: number } | null = null;

  for (const line of text.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    if (!line.trim()) {
      open = null;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      seenHeading = true;
      group = groupFor(heading[1]);
      open = null;
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      if (group) {
        groups[group].push(item[1]);
        open = { items: groups[group], index: groups[group].length - 1 };
      } else {
        open = null;
      }
      continue;
    }

    if (open) {
      open.items[open.index] += ` ${line}`;
    } else if (!seenHeading) {
      headline.push(line);
    }
  }

  const notes: ReleaseNotes = {};
  const summary = plainText(headline.join(" "));
  if (summary) notes.headline = summary;

  let count = 0;
  for (const { key } of CHANGE_GROUPS) {
    const items = groups[key].map(plainText).filter(Boolean);
    if (items.length) notes[key] = items;
    count += items.length;
  }
  if (silent || count === 0) notes.silent = true;
  return notes;
}

/** The fields of a GitHub release the changelog reads. */
export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  published_at: string | null;
  body?: string | null;
}

/**
 * A published release as a changelog entry, or null for a draft or a tag
 * that isn't a release version (the footer's resolver ignores those too).
 * The date is the day it was published in Malaysia, the platform's home time
 * zone.
 */
export function toChangelogEntry(
  release: GitHubRelease,
): ChangelogEntry | null {
  if (release.draft || !isReleaseVersion(release.tag_name)) return null;
  const date = toCalendarDateInTimeZone(release.published_at);
  if (!date) return null;
  return {
    version: release.tag_name,
    date,
    ...parseReleaseNotes(release.body),
  };
}
