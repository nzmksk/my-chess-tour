import { Octokit } from "@octokit/rest";

const REPO_OWNER = "nzmksk";
const REPO_NAME = "my-chess-tour";

export async function getIssueProgress(): Promise<{
  resolved: number;
  total: number;
  percentage: number;
}> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const [closedResult, allResult] = await Promise.all([
    octokit.rest.search.issuesAndPullRequests({
      q: `repo:${REPO_OWNER}/${REPO_NAME} type:issue state:closed`,
      per_page: 1,
    }),
    octokit.rest.search.issuesAndPullRequests({
      q: `repo:${REPO_OWNER}/${REPO_NAME} type:issue`,
      per_page: 1,
    }),
  ]);

  const resolved = closedResult.data.total_count;
  const total = allResult.data.total_count;
  const percentage = total > 0 ? Math.round((resolved / total) * 100) : 0;

  return { resolved, total, percentage };
}
