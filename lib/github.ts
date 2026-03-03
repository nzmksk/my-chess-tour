import { Octokit } from "@octokit/rest";

const REPO_OWNER = "nzmksk";
const REPO_NAME = "my-chess-tour";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours in ms

let cache: { value: number; timestamp: number } | null = null;

/** Exposed for unit-testing only — clears the in-memory cache. */
export function _clearCacheForTesting() {
  cache = null;
}

export async function getIssueProgress(): Promise<number> {
  const now = Date.now();
  if (cache && now - cache.timestamp < CACHE_TTL) {
    return cache.value;
  }

  try {
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

    cache = { value: percentage, timestamp: now };
    return percentage;
  } catch (error) {
    console.log("Failed to fetch issue progress from GitHub API", error);
    return 0;
  }
}
