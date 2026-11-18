import { Octokit } from "@octokit/rest";

const REPO = { owner: "nzmksk", repo: "my-chess-tour" } as const;

/** `user-reported` must exist on the repo; `bug` is GitHub's default label. */
export const BUG_REPORT_LABELS = ["bug", "user-reported"];

// Short enough that a slow GitHub can't hold the request until the function
// itself times out, so the route still answers and records the failure.
const GITHUB_TIMEOUT_MS = 8000;

/**
 * File a bug report as an issue on the repo and return its number.
 *
 * GITHUB_TOKEN should be a fine-grained token scoped to this repo with
 * Issues: write and nothing else. Throws when the token is missing or GitHub
 * refuses; the caller records the failure on the bug_reports row.
 */
export async function createBugReportIssue(
  title: string,
  body: string,
): Promise<number> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }
  const octokit = new Octokit({
    auth: token,
    request: { signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) },
  });
  const { data } = await octokit.rest.issues.create({
    ...REPO,
    title,
    body,
    labels: BUG_REPORT_LABELS,
  });
  return data.number;
}
