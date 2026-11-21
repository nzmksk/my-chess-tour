import { Octokit } from "@octokit/rest";
import { unstable_cache } from "next/cache";
import { compareVersions, type ChangelogEntry } from "@/lib/changelog";
import { toChangelogEntry } from "@/lib/release-notes";
import { logInternalError } from "@/lib/http/internal-error";
import { REPO } from "@/services/github/repo";

export const GITHUB_RELEASES_TAG = "github-releases";

const GITHUB_TIMEOUT_MS = 8000;

async function fetchChangelog(): Promise<ChangelogEntry[]> {
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN || undefined,
    request: { signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) },
  });
  const releases = await octokit.paginate(octokit.rest.repos.listReleases, {
    ...REPO,
    per_page: 100,
  });
  return releases
    .map(toChangelogEntry)
    .filter((entry): entry is ChangelogEntry => entry !== null)
    .sort((a, b) => compareVersions(b.version, a.version));
}

export const getChangelog = unstable_cache(
  fetchChangelog,
  ["github-releases"],
  { tags: [GITHUB_RELEASES_TAG], revalidate: false },
);

export async function loadChangelog(): Promise<ChangelogEntry[] | null> {
  try {
    return await getChangelog();
  } catch (error) {
    logInternalError("Changelog: could not read the GitHub releases", error);
    return null;
  }
}
