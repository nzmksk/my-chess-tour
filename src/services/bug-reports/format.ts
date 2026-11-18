/**
 * Turning an in-app bug report into a GitHub issue (#616).
 *
 * The repo is PUBLIC, so everything here is written for publication:
 *
 * - The reporter's own text goes into fenced code blocks. GitHub does not
 *   process @mentions, #issue references, HTML, images or links inside code,
 *   so a report can't ping anyone, cross-link into other issues, or hide
 *   content in an HTML comment. The fence is always longer than any backtick
 *   run in the text, so the text can't close it early.
 * - Characters that hide or reorder text (controls, zero-width, bidi
 *   overrides) are stripped before anything else sees the text.
 * - The context table carries no identity: no email, name, user id or IP.
 *   The page path has invitation tokens and ids masked.
 *
 * Who sent the report is kept privately in bug_reports, never here.
 */

export const DESCRIPTION_MAX_LENGTH = 4000;
export const DETAILS_MAX_LENGTH = 4000;
const TITLE_SUMMARY_MAX_LENGTH = 80;
const CONTEXT_VALUE_MAX_LENGTH = 300;

// C0/C1 controls (keeping \t and \n), zero-width and joiner characters, bidi
// embeddings/overrides/isolates, and the BOM.
const HIDDEN_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/**
 * Normalise user-typed text: one newline style, no hidden characters, no runs
 * of blank lines, no surrounding whitespace. Length limits apply to the result.
 */
export function cleanText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(HIDDEN_CHARACTERS, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/** Text as a fenced code block that nothing inside it can close. */
export function codeBlock(text: string): string {
  const longestRun = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text}\n${fence}`;
}

// A table cell value: one line, in a code span, with pipes escaped (GFM splits
// cells on "|" even inside code spans).
function codeSpan(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  const longestRun = Math.max(
    0,
    ...(oneLine.match(/`+/g) ?? []).map((run) => run.length),
  );
  const ticks = "`".repeat(longestRun + 1);
  const padded = oneLine.startsWith("`") || oneLine.endsWith("`");
  const inner = padded ? ` ${oneLine} ` : oneLine;
  return `${ticks}${inner.replaceAll("|", "\\|")}${ticks}`;
}

/**
 * `[User report] <first line of the description>`, truncated.
 *
 * Titles are plain text, but GitHub still links #123 in them, so @ and #
 * references are broken with a zero-width space.
 */
export function issueTitle(description: string): string {
  const firstLine =
    description
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ");
  const summary =
    collapsed.length > TITLE_SUMMARY_MAX_LENGTH
      ? `${collapsed.slice(0, TITLE_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`
      : collapsed;
  const neutralised = summary.replace(/@/g, "@​").replace(/#(?=\d)/g, "#​");
  return `[User report] ${neutralised}`;
}

const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mask the secrets a page path can carry. An invitation link's token grants
 * the membership it was sent for (only its hash is stored), so it never
 * leaves the browser intact, not even into bug_reports.
 *
 * Generic rule as well as the known route: a long base64url-looking segment
 * (mixed case or underscores, or long hex) is masked. Tournament slugs are
 * lowercase words and digits joined by hyphens, so they survive.
 */
export function stripPathSecrets(path: string): string {
  const segments = path.split("/");
  return segments
    .map((segment, i) => {
      if (i > 0 && segments[i - 1] === "invitations" && segment) {
        return "[token]";
      }
      const looksLikeToken =
        segment.length >= 20 &&
        /^[A-Za-z0-9_-]+$/.test(segment) &&
        (/[A-Z_]/.test(segment) || /^[0-9a-f]+$/i.test(segment));
      return looksLikeToken ? "[token]" : segment;
    })
    .join("/");
}

/**
 * The path as published in the issue: secrets masked, and record ids too,
 * since /profile/<id> names a person. The private row keeps the ids.
 */
export function publicPath(path: string): string {
  return stripPathSecrets(path)
    .split("/")
    .map((segment) => (UUID_SEGMENT.test(segment) ? "[id]" : segment))
    .join("/");
}

/**
 * Reduce whatever the browser sent as its location to a path: no origin, no
 * query string and no fragment (both can carry tokens or an email address).
 */
export function toPathname(location: string): string | null {
  try {
    const url = new URL(location, "https://placeholder.invalid");
    return url.pathname;
  } catch {
    return null;
  }
}

/** Everything published about the circumstances of a report. */
export type IssueContext = {
  reference: string;
  path: string | null;
  userAgent: string | null;
  viewport: string | null;
  appVersion: string;
  environment: string;
  reportedAt: string;
  signedIn: boolean;
  sentryEventId: string | null;
};

function contextTable(context: IssueContext): string {
  const rows: [string, string | null][] = [
    ["Reference", context.reference],
    ["Page", context.path ? publicPath(context.path) : null],
    ["Browser", context.userAgent],
    ["Viewport", context.viewport],
    ["App version", context.appVersion],
    ["Environment", context.environment],
    ["Reported at", context.reportedAt],
    ["Signed in", context.signedIn ? "yes" : "no"],
    ["Sentry event", context.sentryEventId],
  ];
  const lines = rows
    .filter((row): row is [string, string] => Boolean(row[1]))
    .map(
      ([label, value]) =>
        `| ${label} | ${codeSpan(value.slice(0, CONTEXT_VALUE_MAX_LENGTH))} |`,
    );
  return ["| | |", "| --- | --- |", ...lines].join("\n");
}

export function issueBody(
  description: string,
  details: string | null,
  context: IssueContext,
): string {
  const sections = [
    "_Sent from the in-app bug report form. The reporter's identity is kept privately; quote the reference to follow up._",
    "### What happened",
    codeBlock(description),
  ];
  if (details) {
    sections.push(
      "### Steps to reproduce / expected behaviour",
      codeBlock(details),
    );
  }
  sections.push("### Context", contextTable(context));
  return sections.join("\n\n");
}

/**
 * The reference shown to the reporter and quoted in the issue: the first
 * eight hex digits of the bug_reports id. Short enough to read out, and
 * support finds the row with `id::text LIKE '<hex>%'`.
 */
export function reportReference(reportId: string): string {
  return `BR-${reportId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}
