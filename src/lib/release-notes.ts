import {
  CHANGE_GROUPS,
  isReleaseVersion,
  type ChangelogEntry,
} from "@/lib/changelog";
import { toCalendarDateInTimeZone } from "@/lib/tournaments/datetime";

type ChangeKey = (typeof CHANGE_GROUPS)[number]["key"];

export type ReleaseNotes = Omit<ChangelogEntry, "version" | "date">;

const END_OF_USER_NOTES = [
  /<!--\s*developer notes\s*-->/i,
  /^#{1,6}[ \t]+What's Changed[ \t]*$/im,
  /^#{1,6}[ \t]+New Contributors[ \t]*$/im,
  /^\*\*Full Changelog\*\*/m,
];

const SILENT_PATTERN = /<!--\s*silent\s*-->/i;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/;
const LIST_ITEM = /^ {0,3}[-*+][ \t]+(.*)$/;

function userNotes(body: string | null | undefined): string {
  const text = (body ?? "").replace(/\r\n?/g, "\n");
  let end = text.length;
  for (const pattern of END_OF_USER_NOTES) {
    const match = pattern.exec(text);
    if (match && match.index < end) end = match.index;
  }
  return text.slice(0, end);
}

function plainText(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlComments(text: string): string {
  let previous: string;
  let current = text;
  do {
    previous = current;
    current = current.replace(/<!--[\s\S]*?-->/g, "");
  } while (current !== previous);
  return current;
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
  let group: ChangeKey | null = null;
  let open: { items: string[]; index: number } | null = null;

  for (const line of stripHtmlComments(text).split("\n")) {
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

export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  published_at: string | null;
  body?: string | null;
}

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
