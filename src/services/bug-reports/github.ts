import { Octokit } from "@octokit/rest";
import { REPO } from "@/services/github/repo";

const BUG_REPORT_LABELS = ["bug", "user-reported"];

const GITHUB_TIMEOUT_MS = 8000;

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
