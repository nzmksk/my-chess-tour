export const DESCRIPTION_MAX_LENGTH = 4000;
export const DETAILS_MAX_LENGTH = 4000;
const TITLE_SUMMARY_MAX_LENGTH = 80;
const CONTEXT_VALUE_MAX_LENGTH = 300;

const HIDDEN_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export function cleanText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(HIDDEN_CHARACTERS, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function codeBlock(text: string): string {
  const longestRun = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text}\n${fence}`;
}

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

export function publicPath(path: string): string {
  return stripPathSecrets(path)
    .split("/")
    .map((segment) => (UUID_SEGMENT.test(segment) ? "[id]" : segment))
    .join("/");
}

export function toPathname(location: string): string | null {
  try {
    const url = new URL(location, "https://placeholder.invalid");
    return url.pathname;
  } catch {
    return null;
  }
}

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

export function reportReference(reportId: string): string {
  return `BR-${reportId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}
