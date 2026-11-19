import { Octokit } from "@octokit/rest";
import { unstable_cache } from "next/cache";
import { compareVersions, type ChangelogEntry } from "@/lib/changelog";
import { toChangelogEntry } from "@/lib/release-notes";
import { logInternalError } from "@/lib/http/internal-error";
import { REPO } from "@/services/github/repo";

/**
 * Tags the cached releases. The GitHub release webhook
 * (/api/v1/webhooks/github) invalidates it whenever a release is published,
 * edited or deleted.
 */
export const GITHUB_RELEASES_TAG = "github-releases";

// Covers every page of the listing, so a slow GitHub can't hold a page
// render until the function itself times out.
const GITHUB_TIMEOUT_MS = 8000;

/**
 * Every published release on the repo as a changelog entry, newest first
 * (#640). Drafts and tags that aren't release versions are left out.
 *
 * GITHUB_TOKEN is optional: every fine-grained token can read a public repo,
 * and with one the request counts against the token's rate limit instead of
 * the shared one for the function's IP address (60 an hour). Throws when
 * GitHub can't be reached or refuses.
 */
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

/**
 * The changelog, cached with no time limit: GitHub is only asked again after
 * the webhook invalidates GITHUB_RELEASES_TAG. A failure is never cached, so
 * the next request tries again.
 */
export const getChangelog = unstable_cache(
  fetchChangelog,
  ["github-releases"],
  { tags: [GITHUB_RELEASES_TAG], revalidate: false },
);

/**
 * getChangelog for pages and routes that can render without it: null when
 * GitHub couldn't be read, with the failure logged (and so sent to Sentry).
 */
export async function loadChangelog(): Promise<ChangelogEntry[] | null> {
  try {
    return await getChangelog();
  } catch (error) {
    logInternalError("Changelog: could not read the GitHub releases", error);
    return null;
  }
}
