import { execFileSync } from "node:child_process";

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
    try {
      run(args);
      return true;
    } catch {}
  }
  return false;
}

export function resolveReleaseVersion(
  run: RunGit = runGit,
  env: Env = process.env,
): string {
  if (env.APP_VERSION) return env.APP_VERSION;

  const onBuildHost = env.NETLIFY === "true" || env.WORKERS_CI === "1";
  if (onBuildHost && !syncTags(run, env)) {
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

  if (onBuildHost) {
    throw new Error(
      "[release-version] No v* git tag is reachable from this commit. " +
        "Set APP_VERSION in the build environment to override.",
    );
  }
  return "dev";
}

export function resolveReleaseCommit(env: Env = process.env): string {
  return (env.COMMIT_REF ?? env.WORKERS_CI_COMMIT_SHA ?? "").slice(0, 7);
}
