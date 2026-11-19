import { execFileSync } from "node:child_process";

/**
 * Resolves the release a build belongs to from git tags, the single source of
 * truth for versions (#621). Releases are GitHub pre-releases tagged on
 * `staging`, so the nearest `v*` tag reachable from the built commit is the
 * release that commit shipped in (or was built on top of). Called from
 * next.config.ts at build time; never at runtime, where there is no git.
 *
 * Netlify clones shallow and without tags, and a cached clone can hold stale
 * ones, so on Netlify the tags and full history are fetched before describing.
 */

type RunGit = (args: string[]) => string;
type Env = Record<string, string | undefined>;

const runGit: RunGit = (args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function attempt(run: RunGit, args: string[]): string | null {
  try {
    return run(args) || null;
  } catch {
    return null;
  }
}

/**
 * Brings the clone's tags up to date. Tries `origin` first, then the public
 * repository URL Netlify exposes, in case the clone's remote is unusable.
 */
function syncTags(run: RunGit, env: Env): boolean {
  const shallow =
    attempt(run, ["rev-parse", "--is-shallow-repository"]) === "true";
  const remotes = ["origin", env.REPOSITORY_URL].filter(
    (remote): remote is string => Boolean(remote),
  );

  for (const remote of remotes) {
    const args = ["fetch", "--quiet", "--force", "--tags"];
    if (shallow) args.push("--unshallow");
    args.push(remote);
    // fetch prints nothing on success, so only a throw signals failure.
    try {
      run(args);
      return true;
    } catch {
      // Try the next remote.
    }
  }
  return false;
}

export function resolveReleaseVersion(
  run: RunGit = runGit,
  env: Env = process.env,
): string {
  // Manual override, for an emergency deploy when git can't be reached.
  if (env.APP_VERSION) return env.APP_VERSION;

  const onNetlify = env.NETLIFY === "true";
  if (onNetlify && !syncTags(run, env)) {
    console.warn(
      "[release-version] Could not fetch git tags; the version may be stale.",
    );
  }

  const tag = attempt(run, [
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v[0-9]*",
  ]);
  if (tag) return tag;

  // A deploy that can't name its release would show testers the wrong one,
  // so fail the build; Netlify keeps serving the previous deploy.
  if (onNetlify) {
    throw new Error(
      "[release-version] No v* git tag is reachable from this commit. " +
        "Set APP_VERSION in the Netlify environment to override.",
    );
  }
  return "dev";
}
